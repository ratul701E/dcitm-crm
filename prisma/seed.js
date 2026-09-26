const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Cleaning up database and setting up minimal clean admin baseline...');

  // 1. Delete dependent transactional records
  await prisma.inboundReply.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.analyticsRollup.deleteMany();

  // 2. Delete campaign sequences and relationships
  await prisma.campaignLeadList.deleteMany();
  await prisma.campaignMailbox.deleteMany();
  await prisma.sequenceVariant.deleteMany();
  await prisma.sequenceStep.deleteMany();
  await prisma.sequence.deleteMany();
  await prisma.campaign.deleteMany();

  // 3. Delete leads and lead lists
  await prisma.lead.deleteMany();
  await prisma.leadList.deleteMany();

  // 4. Delete segments, templates, suppression
  await prisma.segment.deleteMany();
  await prisma.emailTemplate.deleteMany();
  await prisma.suppressionEntry.deleteMany();

  // 5. Delete warmup plans, mailboxes, domains
  await prisma.warmupPlan.deleteMany();
  await prisma.mailbox.deleteMany();
  await prisma.domain.deleteMany();

  // 6. Delete audit logs
  await prisma.auditLog.deleteMany();

  // 7. Delete all users
  await prisma.user.deleteMany();

  // 8. Ensure Single Admin Account exists with clean credentials
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@dcitm.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPassword123!';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  console.log('✨ Clean seed completed successfully.');
  console.log(`👤 Admin Account: ${admin.email}`);
  console.log(`🔑 Admin Password: ${adminPassword}`);
  console.log('📦 Database state: 0 mock leads, 0 mock mailboxes, 0 mock campaigns, 0 mock logs. Completely clean.');
}

main()
  .catch((e) => {
    console.error('❌ Clean seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
