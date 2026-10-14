-- AlterTable: lease that serializes AI replies per conversation
ALTER TABLE "conversations" ADD COLUMN "aiLockedUntil" TIMESTAMP(3);

-- AlterTable: the agent runs on Claude Opus 5.5 by default
ALTER TABLE "ai_configs" ALTER COLUMN "model" SET DEFAULT 'claude-opus-5-5';

-- No screen could change the model before this release, so every stored value is the
-- old default rather than a merchant's choice.
UPDATE "ai_configs" SET "model" = 'claude-opus-5-5' WHERE "model" = 'claude-sonnet-5';
