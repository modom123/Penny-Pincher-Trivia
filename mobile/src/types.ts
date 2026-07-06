export type RoundStartPayload = {
  roundNumber: number;
  questionText: string;
  options: Record<'A' | 'B' | 'C' | 'D', string>;
  costCents: number;
  timeLimitSeconds: number;
  serverStartTimeMs: number;
  isOvertime?: boolean;
};

export type RoundEndPayload = {
  roundNumber: number;
  correctOption: string;
  leaderboard: { userId: string; score: number }[];
  isFinalRound: boolean;
};

export type GameCompletedPayload = {
  gameId: string;
  totalPrizePoolCents: number;
  adminRevenuePoolCents: number;
  payouts: { userId: string; place: number; amountCents: number; totalScore: number }[];
};

export type RootStackParamList = {
  Auth: undefined;
  Lobby: undefined;
  Wallet: undefined;
  Game: { gameId: string };
  Results: { payload: GameCompletedPayload };
};
