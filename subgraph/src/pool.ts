import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { Swap, MemberJoined } from "../generated/templates/Pool/Pool";
import { Protocol, ProtocolDayData, Pool, Member } from "../generated/schema";

const FACTORY_ADDRESS = "1";

export function handleSwap(event: Swap): void {
  let pool = Pool.load(event.address.toHexString());
  if (!pool) return;

  // Mock USD pricing calculation for volume (e.g., token0 amount * price)
  let volumeUSD = event.params.amount0In.toBigDecimal().div(BigDecimal.fromString("1e18"));

  // Update Pool stats
  pool.volumeUSD = pool.volumeUSD.plus(volumeUSD);
  pool.save();

  // Update Protocol global stats
  let protocol = Protocol.load(FACTORY_ADDRESS);
  if (protocol) {
    protocol.totalVolumeUSD = protocol.totalVolumeUSD.plus(volumeUSD);
    protocol.save();
  }

  // Update Daily Aggregates
  let dayID = event.block.timestamp.toI32() / 86400;
  let dayData = ProtocolDayData.load(dayID.toString());
  if (!dayData) {
    dayData = new ProtocolDayData(dayID.toString());
    dayData.date = dayID * 86400;
    dayData.tvlUSD = protocol ? protocol.totalValueLockedUSD : BigDecimal.fromString("0");
    dayData.dailyVolumeUSD = BigDecimal.fromString("0");
    dayData.totalMembers = protocol ? protocol.totalMembers : BigInt.fromI32(0);
  }

  dayData.dailyVolumeUSD = dayData.dailyVolumeUSD.plus(volumeUSD);
  dayData.tvlUSD = protocol ? protocol.totalValueLockedUSD : BigDecimal.fromString("0");
  dayData.save();
}

export function handleMemberJoined(event: MemberJoined): void {
  let memberId = event.params.member.toHexString();
  let member = Member.load(memberId);

  if (!member) {
    member = new Member(memberId);
    member.joinedTimestamp = event.block.timestamp;
    member.txCount = BigInt.fromI32(1);
    member.save();

    let protocol = Protocol.load(FACTORY_ADDRESS);
    if (protocol) {
      protocol.totalMembers = protocol.totalMembers.plus(BigInt.fromI32(1));
      protocol.save();
    }
  } else {
    member.txCount = member.txCount.plus(BigInt.fromI32(1));
    member.save();
  }
}