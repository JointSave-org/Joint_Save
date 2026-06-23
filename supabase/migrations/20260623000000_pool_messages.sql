-- Migration: Real-time Pool Chat Messages
-- Description: Adds pool_messages table with RLS policy, realtime enablement, and database-enforced rate limiting / validation.

-- 1. Create pool_messages table
CREATE TABLE IF NOT EXISTS pool_messages (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id        UUID    NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  sender_address TEXT    NOT NULL,
  message        TEXT    NOT NULL CONSTRAINT chk_message_length CHECK (char_length(message) <= 1000),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for querying chat history quickly by pool_id and date
CREATE INDEX IF NOT EXISTS idx_pool_messages_pool_id_created_at
  ON pool_messages(pool_id, created_at ASC);

-- 2. Create function to extract wallet address from request headers or JWT claims
CREATE OR REPLACE FUNCTION get_request_wallet_address()
RETURNS TEXT AS $$
DECLARE
  headers_text TEXT;
  claims_text TEXT;
  addr TEXT;
BEGIN
  -- Try to get from header first
  BEGIN
    headers_text := current_setting('request.headers', true);
    IF headers_text IS NOT NULL AND headers_text <> '' THEN
      addr := (headers_text::jsonb)->>'x-wallet-address';
      IF addr IS NOT NULL THEN
        RETURN lower(addr);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore JSON parsing errors
  END;

  -- Try to get from JWT claims
  BEGIN
    claims_text := current_setting('request.jwt.claims', true);
    IF claims_text IS NOT NULL AND claims_text <> '' THEN
      addr := (claims_text::jsonb)->>'wallet_address';
      IF addr IS NOT NULL THEN
        RETURN lower(addr);
      END IF;
      
      addr := (claims_text::jsonb)->'user_metadata'->>'wallet_address';
      IF addr IS NOT NULL THEN
        RETURN lower(addr);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore JSON parsing errors
  END;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Enable Row Level Security (RLS)
ALTER TABLE pool_messages ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies restricting access to pool members only
CREATE POLICY "Allow pool members to read messages" ON pool_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pool_members
      WHERE pool_members.pool_id = pool_messages.pool_id
        AND LOWER(pool_members.member_address) = LOWER(get_request_wallet_address())
    )
  );

CREATE POLICY "Allow pool members to insert messages" ON pool_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pool_members
      WHERE pool_members.pool_id = pool_messages.pool_id
        AND LOWER(pool_members.member_address) = LOWER(get_request_wallet_address())
    )
    AND LOWER(sender_address) = LOWER(get_request_wallet_address())
  );

-- 5. Rate limiting logic: Max 1 message per 3 seconds per sender
CREATE OR REPLACE FUNCTION enforce_message_rate_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pool_messages
    WHERE LOWER(sender_address) = LOWER(NEW.sender_address)
      AND created_at >= NOW() - INTERVAL '3 seconds'
  ) THEN
    RAISE EXCEPTION 'Rate limit exceeded. Please wait 3 seconds between messages.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_enforce_message_rate_limit
BEFORE INSERT ON pool_messages
FOR EACH ROW
EXECUTE FUNCTION enforce_message_rate_limit();

-- 6. Notification integration: Notify other pool members on message insert
CREATE OR REPLACE FUNCTION notify_pool_message_inserted()
RETURNS TRIGGER AS $$
DECLARE
  p_name TEXT;
BEGIN
  -- Get pool name
  SELECT name INTO p_name FROM pools WHERE id = NEW.pool_id;
  
  -- Insert a notification for all other members of this pool
  INSERT INTO notifications (wallet_address, pool_id, activity_type, message)
  SELECT 
    member_address, 
    NEW.pool_id, 
    'new_message', 
    'New message in ' || COALESCE(p_name, 'pool') || ': ' || substring(NEW.message from 1 for 50)
  FROM pool_members
  WHERE pool_id = NEW.pool_id
    AND LOWER(member_address) <> LOWER(NEW.sender_address);
    
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Make sure failing to notify does not block message insertion
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trigger_notify_pool_message_inserted
AFTER INSERT ON pool_messages
FOR EACH ROW
EXECUTE FUNCTION notify_pool_message_inserted();

-- 7. Enable Realtime replication for pool_messages
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pool_messages;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore errors if table is already in publication or publication does not exist
END;
$$;
