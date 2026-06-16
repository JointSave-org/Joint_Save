// Unit Tests for Analytics Calculations
import { test, mock } from 'node:test';
import assert from 'node:assert';
import {
  calculatePoolHealth,
  predictTargetPoolCompletion,
  aggregateHistoricalData,
} from './analytics';

test('calculatePoolHealth - Rotational Pool health calculations', () => {
  const pool = {
    type: 'rotational' as const,
    status: 'active' as const,
  };

  // 1. Perfect health (no late members, all active)
  const members = [
    { member_address: 'addr1', status: 'paid' },
    { member_address: 'addr2', status: 'paid' },
  ];
  const activities = [
    { activity_type: 'deposit', amount: 100, created_at: '2026-06-15T00:00:00Z' },
  ];

  const result1 = calculatePoolHealth(pool, members, activities);
  assert.strictEqual(result1.healthScore, 100);
  assert.strictEqual(result1.riskIndicator, 'Low');

  // 2. Late member deduction
  const membersWithLate = [
    { member_address: 'addr1', status: 'paid' },
    { member_address: 'addr2', status: 'late' }, // 50% late
  ];
  const result2 = calculatePoolHealth(pool, membersWithLate, activities);
  // 50% late members should deduct (0.5 * 50) = 25 points -> health score = 75 (Medium risk)
  assert.strictEqual(result2.healthScore, 75);
  assert.strictEqual(result2.riskIndicator, 'Medium');

  // 3. Paused status deduction
  const pausedPool = {
    type: 'rotational' as const,
    status: 'paused' as const,
  };
  const result3 = calculatePoolHealth(pausedPool, members, activities);
  // 100 - 30 = 70 (Medium risk)
  assert.strictEqual(result3.healthScore, 70);
  assert.strictEqual(result3.riskIndicator, 'Medium');
});

test('calculatePoolHealth - Target Pool health calculations', () => {
  const pool = {
    type: 'target' as const,
    status: 'active' as const,
    target_amount: 1000,
    deadline: '2026-07-16T00:00:00Z',
    created_at: '2026-06-16T00:00:00Z',
  };

  const members = [
    { member_address: 'addr1', status: 'pending', contribution_amount: 0 },
    { member_address: 'addr2', status: 'pending', contribution_amount: 0 },
  ];

  // 1. 0% participation (100 - 30 = 70 health score)
  const result1 = calculatePoolHealth(pool, members, []);
  assert.strictEqual(result1.healthScore, 70);
  assert.strictEqual(result1.riskIndicator, 'Medium');

  // 2. Deadline passed and target not met -> Health score = 0 (High risk)
  const passedPool = {
    ...pool,
    deadline: '2026-06-15T00:00:00Z', // In the past
  };
  const result2 = calculatePoolHealth(passedPool, members, []);
  assert.strictEqual(result2.healthScore, 0);
  assert.strictEqual(result2.riskIndicator, 'High');
});

test('calculatePoolHealth - Flexible Pool health calculations', () => {
  const pool = {
    type: 'flexible' as const,
    status: 'active' as const,
  };

  const members = [
    { member_address: 'addr1', status: 'pending', contribution_amount: 50 },
    { member_address: 'addr2', status: 'pending', contribution_amount: 50 },
  ];

  // 100% participation, but high withdrawal ratio
  const activities = [
    { activity_type: 'deposit', amount: 100, created_at: '2026-06-16T00:00:00Z' },
    { activity_type: 'withdraw', amount: 95, created_at: '2026-06-16T12:00:00Z' }, // 95% withdraw
  ];

  const result1 = calculatePoolHealth(pool, members, activities);
  // Withdrawal ratio > 0.9 -> deducts 30 points -> health score = 70
  assert.strictEqual(result1.healthScore, 70);
  assert.strictEqual(result1.riskIndicator, 'Medium');
});

test('predictTargetPoolCompletion calculations', () => {
  const targetAmount = 1000;

  // 1. Target already reached
  const res1 = predictTargetPoolCompletion(targetAmount, 1050, []);
  assert.strictEqual(res1.daysToTarget, 0);
  assert.strictEqual(res1.message, 'Target already reached!');

  // 2. Normal progression: 500 saved, target 1000, 2 deposits of 100 on day 1 and 200 on day 2
  const activities = [
    { activity_type: 'deposit', amount: 100, created_at: '2026-06-16T00:00:00Z' },
    { activity_type: 'deposit', amount: 200, created_at: '2026-06-17T00:00:00Z' },
  ];
  const res2 = predictTargetPoolCompletion(targetAmount, 500, activities);
  // Total deposited: 300, duration 1 day -> rate is 300 XLM/day
  // Remaining: 500 -> days to target = 500 / 300 = 1.666
  assert.ok(res2.daysToTarget > 1.6 && res2.daysToTarget < 1.7);
  assert.ok(res2.message.includes('Projected to reach target in approximately 2 days'));

  // 3. No deposits
  const res3 = predictTargetPoolCompletion(targetAmount, 100, []);
  assert.strictEqual(res3.daysToTarget, -1);
  assert.ok(res3.message.includes('No deposits recorded yet'));
});

test('aggregateHistoricalData calculations', () => {
  const activities = [
    { activity_type: 'deposit', amount: 100, created_at: '2026-06-16T08:00:00Z' },
    { activity_type: 'deposit', amount: 150, created_at: '2026-06-16T10:00:00Z' },
    { activity_type: 'withdraw', amount: 50, created_at: '2026-06-17T09:00:00Z' },
    { activity_type: 'deposit', amount: 200, created_at: '2026-06-18T12:00:00Z' },
  ];

  const points = aggregateHistoricalData(activities, '2026-06-15T00:00:00Z');

  // We should have a creation date point, then 2026-06-16, 2026-06-17, 2026-06-18
  assert.strictEqual(points.length, 4);

  // Day 0: Creation date
  assert.strictEqual(points[0].date, '2026-06-15');
  assert.strictEqual(points[0].balance, 0);

  // Day 1: Deposits of 100 + 150 = 250
  assert.strictEqual(points[1].date, '2026-06-16');
  assert.strictEqual(points[1].deposits, 250);
  assert.strictEqual(points[1].balance, 250);

  // Day 2: Withdrawal of 50
  assert.strictEqual(points[2].date, '2026-06-17');
  assert.strictEqual(points[2].deposits, 250);
  assert.strictEqual(points[2].withdrawals, 50);
  assert.strictEqual(points[2].balance, 200);

  // Day 3: Deposit of 200
  assert.strictEqual(points[3].date, '2026-06-18');
  assert.strictEqual(points[3].deposits, 450);
  assert.strictEqual(points[3].withdrawals, 50);
  assert.strictEqual(points[3].balance, 400);
});
