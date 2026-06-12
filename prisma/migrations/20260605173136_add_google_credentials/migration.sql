-- CreateTable
CREATE TABLE "google_credentials" (
    "key" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_credentials_pkey" PRIMARY KEY ("key")
);
