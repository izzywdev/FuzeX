// identity.ts — this app's identity surface, re-exported from @fuzex/identity
// (packages/identity — see its README.md for why this repo keeps its own
// registry instead of depending on @izzywdev/fuzefront-identity).

export {
  mintId,
  parseId,
  assertRef,
  tryParseId,
  isId,
  toUuid,
  fromUuid,
  entityTypeOf,
  configureIdentity,
  ENTITY_PREFIXES,
  ENTITY_TYPES,
  isEntityType,
  IdentityError,
  type EntityId,
  type EntityType,
} from '@fuzex/identity';

// discussion.target_type ('project'|'feature'|'flow'|'frame'|'element') ->
// the EntityType actually stored (frame_ref backs both 'frame' and
// 'element' targets — see db/migrations/0008_create_discussion.sql).
import type { EntityType } from '@fuzex/identity';

export type DiscussionTargetType = 'project' | 'feature' | 'flow' | 'frame' | 'element';

export const DISCUSSION_TARGET_ENTITY_TYPE: Record<DiscussionTargetType, EntityType> = {
  project: 'project',
  feature: 'feature',
  flow: 'flow',
  frame: 'frameRef',
  element: 'frameRef',
};
