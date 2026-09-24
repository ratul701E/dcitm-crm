const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const lead = await prisma.lead.findUnique({
    where: { id: '04032762-0653-4c2f-8af2-b51df0adde1c' },
    include: { emailLogs: true }
  });
  console.log('LEAD 04032762:', JSON.stringify(lead, null, 2));

  const sequences = await prisma.sequence.findMany({
    include: { steps: { include: { variants: true } } }
  });
  console.log('SEQUENCES:', JSON.stringify(sequences, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
