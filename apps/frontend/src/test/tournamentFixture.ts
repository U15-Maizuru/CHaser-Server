import type { StageRules, TournamentFormat } from '@u15/ws-types';
import { DEFAULT_LEAGUE_POINTS } from '@u15/ws-types';

// 大会関連コンポーネントのテストが使う共通の雛形。
// 形式ごとの StageRules を1箇所で組み、各テストは違いのある項目だけを上書きする。

const LEAGUE = { points: DEFAULT_LEAGUE_POINTS, doubleRoundRobin: false };

const MAP = { catalogId: null, bracketStages: [] };

/**
 * その形式で意味のある既定値が入った StageRules。
 *
 * 返り値は渡した形式に絞られるので、`{ ...stageRulesFor('league'), points: … }` の形で
 * その形式にしかない項目だけを上書きできる。
 */
export function stageRulesFor<F extends TournamentFormat>(
  format: F,
): Extract<StageRules, { format: F }> {
  return build(format) as Extract<StageRules, { format: F }>;
}

function build(format: TournamentFormat): StageRules {
  switch (format) {
    case 'single-elimination':
      return { format, map: MAP, thirdPlaceMatch: false };
    case 'league':
      return { format, map: MAP, league: LEAGUE };
    case 'group-then-bracket':
      return {
        format, map: MAP, thirdPlaceMatch: false, league: LEAGUE,
        groupCount: 2, advancePerGroup: 2, qualifyingDoubleMode: true,
        groupScheduleMode: 'parallel',
      };
    case 'bot-then-bracket':
      return {
        format, map: MAP, thirdPlaceMatch: false, advanceCount: 4,
        bot: { program: null, name: null, map: 'map-1', participantSide: 0 },
        qualifyingDoubleMode: true,
      };
  }
}
