import { rpc } from "@stellar/stellar-sdk";

/**
 * Log-safe resource estimate from a Soroban simulation.
 *
 * Values are intentionally plain numbers so they can be logged, cached, or
 * sent to telemetry without shipping XDR.
 */
export interface SimulationEstimate {
  instructions: number;
  readBytes: number;
  writeBytes: number;
  feeStroops: number;
}

const EMPTY_ESTIMATE: SimulationEstimate = {
  instructions: 0,
  readBytes: 0,
  writeBytes: 0,
  feeStroops: 0,
};

/**
 * Summarize a simulation response.
 *
 * Failed simulations return zeroed counters rather than throwing, so callers
 * can always log the estimate path.
 */
export function summarizeSimulation(
  simulation: rpc.Api.SimulateTransactionResponse
): SimulationEstimate {
  if (rpc.Api.isSimulationError(simulation)) {
    return { ...EMPTY_ESTIMATE };
  }

  const resources = simulation.transactionData.build().resources();
  return {
    instructions: resources.instructions(),
    readBytes: resources.diskReadBytes(),
    writeBytes: resources.writeBytes(),
    feeStroops: toStroops(simulation.minResourceFee),
  };
}

function toStroops(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
