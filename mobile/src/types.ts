export type RoundStartPayload = {
  roundNumber: number;
  questionText: string;
  imageUrl?: string | null;
  options: Record<'A' | 'B' | 'C' | 'D', string>;
  costCents: number;
  timeLimitSeconds: number;
  serverStartTimeMs: number;
  totalPrizePoolCents?: number;
  isOvertime?: boolean;
};

export type RoundEndPayload = {
  roundNumber: number;
  correctOption: string;
  leaderboard: { userId: string; username?: string; score: number }[];
  totalPrizePoolCents?: number;
  isFinalRound: boolean;
};

export type GameCompletedPayload = {
  gameId: string;
  totalPrizePoolCents: number;
  adminRevenuePoolCents: number;
  payouts: { userId: string; username?: string; place: number; amountCents: number; totalScore: number }[];
  // No eligible winner (e.g. everyone ran out of tokens before round 100) -
  // payout_game creates a similarly-configured replacement game and seeds its
  // pool with this one's, rather than the money just sitting unpaid forever.
  noWinner?: boolean;
  rolloverGameId?: string | null;
};

export type ChatMessage = {
  id: string;
  game_id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
};

export type MainTabParamList = {
  Home: undefined;
  Wallet: undefined;
  Leaderboard: undefined;
  Refer: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Username: undefined;
  Main: { screen?: keyof MainTabParamList } | undefined;
  Game: { gameId: string };
  Results: { payload: GameCompletedPayload };
};
