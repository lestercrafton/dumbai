import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "lester@ovanova.co";
  const admin = await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Lester Crafton",
      role: "ADMIN",
      timeZone: "America/Los_Angeles",
    },
  });

  for (let day = 1; day <= 5; day++) {
    await db.availability.upsert({
      where: { userId_dayOfWeek: { userId: admin.id, dayOfWeek: day } },
      update: {},
      create: { userId: admin.id, dayOfWeek: day, startTime: "09:00", endTime: "17:00" },
    });
  }

  const eventTypes = [
    {
      slug: "discovery-call",
      title: "30-min Discovery Call",
      description: "A quick intro to understand your resilience goals and see if Ovanova is the right fit.",
      durationMinutes: 30,
      category: "sales",
      locationType: "GOOGLE_MEET",
      questions: [
        { label: "What best describes your organization?", type: "SELECT", required: true, options: JSON.stringify(["Commercial / Industrial", "Municipal / Government", "Residential Community", "Healthcare / Critical Facility", "Other"]) },
        { label: "What is your primary interest?", type: "SELECT", required: true, options: JSON.stringify(["Microgrid design", "Solar + storage", "Backup power / resilience", "EV charging infrastructure", "Energy cost reduction", "Other"]) },
        { label: "Facility location (city, state)", type: "TEXT", required: false },
        { label: "Anything else we should know?", type: "TEXTAREA", required: false },
      ],
    },
    {
      slug: "site-assessment",
      title: "Site Assessment",
      description: "On-site or virtual walkthrough to scope a microgrid or backup power project.",
      durationMinutes: 60,
      category: "engineering",
      locationType: "GOOGLE_MEET",
      questions: [
        { label: "Site address", type: "TEXT", required: true },
        { label: "Approximate facility size (sq ft)", type: "TEXT", required: false },
        { label: "Current utility provider", type: "TEXT", required: false },
        { label: "Average monthly electricity bill ($)", type: "TEXT", required: false },
        { label: "Do you have existing solar or battery systems?", type: "SELECT", required: true, options: JSON.stringify(["Yes", "No", "Not sure"]) },
        { label: "Project timeline", type: "SELECT", required: false, options: JSON.stringify(["ASAP", "1-3 months", "3-6 months", "6-12 months", "Just exploring"]) },
      ],
    },
    {
      slug: "technical-consultation",
      title: "Technical Consultation",
      description: "Deep-dive with an Ovanova engineer on system design, load profiles, and integration.",
      durationMinutes: 45,
      category: "engineering",
      locationType: "GOOGLE_MEET",
      questions: [
        { label: "Project type", type: "SELECT", required: true, options: JSON.stringify(["New microgrid", "Solar + storage", "Generator integration", "EV infrastructure", "Grid-tied DER", "Other"]) },
        { label: "Peak load (kW), if known", type: "TEXT", required: false },
        { label: "Key technical questions or concerns", type: "TEXTAREA", required: true },
        { label: "Relevant documents (link to drawings, load data, etc.)", type: "TEXT", required: false },
      ],
    },
    {
      slug: "partner-meeting",
      title: "Partner Meeting",
      description: "For vendors, installers, and channel partners working with Ovanova.",
      durationMinutes: 30,
      category: "operations",
      locationType: "GOOGLE_MEET",
      questions: [
        { label: "Company name", type: "TEXT", required: true },
        { label: "Partnership type", type: "SELECT", required: true, options: JSON.stringify(["Equipment vendor", "Installation partner", "Channel / reseller", "Technology integration", "Other"]) },
        { label: "What would you like to discuss?", type: "TEXTAREA", required: false },
      ],
    },
  ];

  for (const et of eventTypes) {
    const { questions, ...eventData } = et;
    const eventType = await db.eventType.upsert({
      where: { slug: eventData.slug },
      update: eventData,
      create: { ...eventData, ownerId: admin.id },
    });
    await db.bookingQuestion.deleteMany({ where: { eventTypeId: eventType.id } });
    for (let i = 0; i < questions.length; i++) {
      await db.bookingQuestion.create({
        data: { eventTypeId: eventType.id, sortOrder: i, ...questions[i] },
      });
    }
  }

  const teams = [
    { slug: "sales", name: "Sales", description: "Discovery calls and demos" },
    { slug: "engineering", name: "Engineering", description: "Site assessments and technical consultations" },
    { slug: "operations", name: "Operations", description: "Partner and vendor coordination" },
  ];

  for (const team of teams) {
    const t = await db.team.upsert({ where: { slug: team.slug }, update: team, create: team });
    await db.teamMembership.upsert({
      where: { userId_teamId: { userId: admin.id, teamId: t.id } },
      update: {},
      create: { userId: admin.id, teamId: t.id, role: "LEAD" },
    });
  }

  console.log("Seed complete: admin user, availability, 4 event types with questions, 3 teams");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
