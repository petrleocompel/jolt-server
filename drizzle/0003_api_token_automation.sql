CREATE TYPE "public"."api_token_friend_scope" AS ENUM('all', 'selected');--> statement-breakpoint
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
ALTER TABLE "api_token_friend" ADD CONSTRAINT "api_token_friend_token_id_api_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token_friend" ADD CONSTRAINT "api_token_friend_friend_id_user_id_fk" FOREIGN KEY ("friend_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_token_friend_friend_idx" ON "api_token_friend" USING btree ("friend_id");--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_scopes_nonempty" CHECK (cardinality("api_token"."scopes") > 0);