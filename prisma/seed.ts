import { PrismaClient } from "@prisma/client";
import { defaultAlgorithmSuggestions } from "../src/modules/algorithmCatalog.js";

const prisma = new PrismaClient();

async function main() {
  for (const algorithm of defaultAlgorithmSuggestions) {
    await prisma.emailAlgorithm.upsert({
      where: { key: algorithm.key },
      update: {
        patternTemplate: algorithm.patternTemplate,
        description: algorithm.description,
        example: algorithm.example
      },
      create: {
        key: algorithm.key,
        patternTemplate: algorithm.patternTemplate,
        description: algorithm.description,
        example: algorithm.example
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
