export interface CompactBoundary {
  type: "compact_boundary";
  reason: "auto_compress" | "emergency_compress";
  truncatedMessageCount: number;
  estimatedTokensSaved: number;
  keyItems: number[];
  timestamp: number;
}
