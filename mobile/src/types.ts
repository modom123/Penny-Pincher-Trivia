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
