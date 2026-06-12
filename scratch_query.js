import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const apps = await prisma.application.findMany();
  console.log("Total Applications:", apps.length);
  console.log("Applications detail:", JSON.stringify(apps, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
