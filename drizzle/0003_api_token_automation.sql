CREATE TYPE "public"."api_token_friend_scope" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."poke_source" AS ENUM('app', 'api_token');--> statement-breakpoint
CREATE TABLE "api_token_friend" (
	"token_id" uuid NOT NULL,
	"friend_id" text NOT NULL,
	CONSTRAINT "api_token_friend_token_id_friend_id_pk" PRIMARY KEY("token_id","friend_id")
);
--> statement-breakpoint
-- Hand-edited: tokens minted before scopes existed could only reach GET /me
-- and POST /me/stimulus, so they get exactly `stimulus:self` — behaviour
-- unchanged. The default exists only to backfill them and is dropped at
-- once; a new token must always say what it may do.
ALTER TABLE "api_token" ADD COLUMN "scopes" text[] DEFAULT '{stimulus:self}' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ALTER COLUMN "scopes" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "friend_scope" "api_token_friend_scope" DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "allowed_kinds" "stimulus_kind"[];--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "max_intensity" integer;--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "min_interval_seconds" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "last_fired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "poke_event" ADD COLUMN "source" "poke_source" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "poke_event" ADD COLUMN "api_token_id" uuid;--> statement-breakpoint
ALTER TABLE "api_token_friend" ADD CONSTRAINT "api_token_friend_token_id_api_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token_friend" ADD CONSTRAINT "api_token_friend_friend_id_user_id_fk" FOREIGN KEY ("friend_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_token_friend_friend_idx" ON "api_token_friend" USING btree ("friend_id");--> statement-breakpoint
ALTER TABLE "poke_event" ADD CONSTRAINT "poke_event_api_token_id_api_token_id_fk" FOREIGN KEY ("api_token_id") REFERENCES "public"."api_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poke_event_api_token_idx" ON "poke_event" USING btree ("api_token_id") WHERE "poke_event"."api_token_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_scopes_nonempty" CHECK (cardinality("api_token"."scopes") > 0);--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_allowed_kinds_nonempty" CHECK ("api_token"."allowed_kinds" IS NULL OR cardinality("api_token"."allowed_kinds") > 0);--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_max_intensity_range" CHECK ("api_token"."max_intensity" IS NULL OR ("api_token"."max_intensity" >= 0 AND "api_token"."max_intensity" <= 100));--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_min_interval_range" CHECK ("api_token"."min_interval_seconds" >= 1 AND "api_token"."min_interval_seconds" <= 86400);