import { assert, describe, test, newMockEvent, clearStore } from "matchstick-as/assembly/index";
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { MemberJoined } from "../generated/templates/Pool/Pool";
import { handleMemberJoined } from "../src/pool";
import { Protocol } from "../generated/schema";

describe("Pool Unit Tests", () => {
  test("Should increment unique total members on MemberJoined event", () => {
    // Setup initial protocol state
    let protocol = new Protocol("1");
    protocol.totalValueLockedUSD = BigInt.fromI32(0).toBigDecimal();
    protocol.totalVolumeUSD = BigInt.fromI32(0).toBigDecimal();
    protocol.activePoolsCount = BigInt.fromI32(0);
    protocol.totalMembers = BigInt.fromI32(0);
    protocol.save();

    // Create mock MemberJoined event
    let mockEvent = newMockEvent();
    let memberAddress = Address.fromString("0x0000000000000000000000000000000000000001");
    
    let memberParam = new ethereum.EventParam("member", ethereum.Value.fromAddress(memberAddress));
    mockEvent.parameters = [memberParam];

    let memberJoinedEvent = new MemberJoined(
      mockEvent.address,
      mockEvent.logIndex,
      mockEvent.transactionLogIndex,
      mockEvent.logType,
      mockEvent.block,
      mockEvent.transaction,
      mockEvent.parameters,
      mockEvent.receipt
    );

    // Run Handler
    handleMemberJoined(memberJoinedEvent);

    // Assertions
    assert.fieldEquals("Protocol", "1", "totalMembers", "1");
    assert.fieldEquals("Member", memberAddress.toHexString(), "txCount", "1");

    clearStore();
  });
});