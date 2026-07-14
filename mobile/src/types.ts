export type MilestoneBonus = {
  applied: boolean;
  reason?: string;
  roundNumber?: number;
  totalBonusCents?: number;
  remainingPoolCents?: number;
  recipients?: { userId: string; username?: string; amountCents: number }[];
};

export type RoundStartPayload = {
  roundNumber: number;
  questionText: string;
  options: Record<'A' | 'B' | 'C' | 'D', string>;
  costCents: number;
  timeLimitSeconds: number;
  serverStartTimeMs: number;
  totalPrizePoolCents?: number;
  isOvertime?: boolean;
  // Milestone Booster only: a pool-funded bonus paid to the round 25/50/75
  // leader(s), carved from money already in the pool (never platform-funded).
  milestoneBonus?: MilestoneBonus;
};

export type RoundEndPayload = {
  roundNumber: number;
  correctOption: string;
  leaderboard: { userId: string; score: number }[];
  totalPrizePoolCents?: number;
  isFinalRound: boolean;
};

export type GameCompletedPayload = {
  gameId: string;
  totalPrizePoolCents: number;
  adminRevenuePoolCents: number;
  payouts: { userId: string; username?: string; place: number; amountCents: number; totalScore: number }[];
};

export type ChatMessage = {
  id: string;
  game_id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
};

export type RootStackParamList = {
  Auth: undefined;
  Lobby: undefined;
  Wallet: undefined;
  Game: { gameId: string };
  Results: { payload: GameCompletedPayload };
};
