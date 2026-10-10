/*
 * The demo dataset: two clubs, their committees and membership types, and 30 people covering every
 * role combination. It is the single source for BOTH `pnpm db:seed` (prisma/seed.ts) and the MSW
 * mocks, so the same accounts exist in both modes. The README's "Seeded accounts" table lists
 * the key personas — update it when you change this file.
 *
 * Personal emails use the reserved example.com domain and phone numbers follow an obviously fake
 * pattern, so no real person's contact details appear in seed data.
 */

import type { MemberProfile } from '@/modules/members/contracts';

export type DemoClubKey = 'computing' | 'tuwaiq';

interface DemoCommittee {
  key: string;
  name: string;
  description: string;
}

export interface DemoClub {
  key: DemoClubKey;
  slug: string;
  name: string;
  description: string;
  /** In display order. */
  membershipTypes: readonly string[];
  committees: readonly DemoCommittee[];
}

export const demoClubs: readonly DemoClub[] = [
  {
    key: 'computing',
    slug: 'computing',
    name: 'نادي الحاسبات',
    description: 'نادي طلاب كلية الحاسبات: برمجة وتصميم وفعاليات تقنية.',
    membershipTypes: ['رئيس النادي', 'نائب الرئيس', 'عضو فعال', 'عضو', 'مستفيد'],
    committees: [
      { key: 'programming', name: 'لجنة البرمجة', description: 'ورش ومعسكرات ومشاريع برمجية.' },
      { key: 'design', name: 'لجنة التصميم', description: 'هوية النادي وتصاميم الفعاليات.' },
      { key: 'events', name: 'لجنة الفعاليات', description: 'تنظيم الفعاليات والهاكاثونات.' },
      { key: 'media', name: 'لجنة الإعلام', description: 'التغطيات والمحتوى على منصات النادي.' },
    ],
  },
  {
    key: 'tuwaiq',
    slug: 'tuwaiq',
    name: 'نادي طويق',
    description: 'نادي يهتم بتطوير المهارات التقنية وريادة الأعمال الرقمية.',
    membershipTypes: ['رئيس', 'عضو فعال', 'مستفيد'],
    committees: [
      { key: 'development', name: 'لجنة التطوير', description: 'مشاريع التطوير والتدريب التقني.' },
      { key: 'content', name: 'لجنة المحتوى', description: 'كتابة المحتوى التقني والنشرات.' },
      { key: 'pr', name: 'لجنة العلاقات العامة', description: 'الشراكات والتواصل مع الجهات.' },
    ],
  },
];

export type DemoPersona =
  'admin' | 'officer' | 'lead' | 'mixed' | 'member' | 'unregistered' | 'removed' | 'no-access';

interface DemoMembership {
  club: DemoClubKey;
  /** One of the club's membership type names. */
  type: string;
  officer?: boolean;
  /** Removed from the club this many days ago. Roles were reset when they were removed. */
  removedDaysAgo?: number;
  committees: ReadonlyArray<{ key: string; lead?: boolean }>;
}

export interface DemoPerson {
  key: string;
  fullName: string;
  uniEmail: string;
  personalEmail?: string;
  phone?: string;
  college?: string;
  major?: string;
  level?: number;
  isFullAdmin?: boolean;
  /** False: added by an admin; the person has not signed up yet, so they cannot be selected. */
  registered: boolean;
  persona: DemoPersona;
  memberships: readonly DemoMembership[];
}

const CS = 'كلية الحاسبات';
const DESIGN = 'كلية التصاميم والفنون';
const BUSINESS = 'كلية إدارة الأعمال';
const SCIENCE = 'كلية العلوم التطبيقية';

export const demoPeople: readonly DemoPerson[] = [
  {
    key: 'abdullah',
    fullName: 'عبدالله محمد الغامدي',
    uniEmail: 'aalghamdi@uqu.edu.sa',
    personalEmail: 'abdullah.alghamdi@example.com',
    phone: '+966500000101',
    isFullAdmin: true,
    registered: true,
    persona: 'admin',
    memberships: [],
  },
  {
    key: 'sara',
    fullName: 'سارة عبدالرحمن القحطاني',
    uniEmail: 's443001102@st.uqu.edu.sa',
    personalEmail: 'sara.alqahtani@example.com',
    phone: '+966500000102',
    college: CS,
    major: 'علوم الحاسب',
    level: 7,
    registered: true,
    persona: 'officer',
    memberships: [
      {
        club: 'computing',
        type: 'نائب الرئيس',
        officer: true,
        committees: [{ key: 'programming' }],
      },
    ],
  },
  {
    key: 'fahad',
    fullName: 'فهد سعد العنزي',
    uniEmail: 's442002118@st.uqu.edu.sa',
    personalEmail: 'fahad.alanazi@example.com',
    phone: '+966500000103',
    college: CS,
    major: 'هندسة البرمجيات',
    level: 8,
    registered: true,
    persona: 'officer',
    memberships: [
      { club: 'tuwaiq', type: 'رئيس', officer: true, committees: [{ key: 'development' }] },
    ],
  },
  {
    key: 'noura',
    fullName: 'نورة خالد الحربي',
    uniEmail: 's443003127@st.uqu.edu.sa',
    personalEmail: 'noura.alharbi@example.com',
    phone: '+966500000104',
    college: CS,
    major: 'الأمن السيبراني',
    level: 6,
    registered: true,
    persona: 'mixed',
    memberships: [
      { club: 'computing', type: 'رئيس النادي', officer: true, committees: [] },
      { club: 'tuwaiq', type: 'مستفيد', committees: [{ key: 'development' }, { key: 'content' }] },
    ],
  },
  {
    key: 'mohammed',
    fullName: 'محمد عبدالله العتيبي',
    uniEmail: 's444001205@st.uqu.edu.sa',
    personalEmail: 'mohammed.alotaibi@example.com',
    phone: '+966500000105',
    college: CS,
    major: 'علوم الحاسب',
    level: 5,
    registered: true,
    persona: 'lead',
    memberships: [
      {
        club: 'computing',
        type: 'عضو فعال',
        committees: [{ key: 'programming', lead: true }, { key: 'design' }],
      },
    ],
  },
  {
    key: 'reem',
    fullName: 'ريم ناصر الشهري',
    uniEmail: 's444002216@st.uqu.edu.sa',
    personalEmail: 'reem.alshehri@example.com',
    phone: '+966500000106',
    college: DESIGN,
    major: 'التصميم الجرافيكي',
    level: 5,
    registered: true,
    persona: 'lead',
    memberships: [
      { club: 'computing', type: 'عضو فعال', committees: [{ key: 'design', lead: true }] },
    ],
  },
  {
    key: 'khalid',
    fullName: 'خالد إبراهيم المالكي',
    uniEmail: 's443004231@st.uqu.edu.sa',
    personalEmail: 'khalid.almalki@example.com',
    phone: '+966500000107',
    college: CS,
    major: 'نظم المعلومات',
    level: 6,
    registered: true,
    persona: 'lead',
    memberships: [
      {
        club: 'computing',
        type: 'عضو فعال',
        committees: [
          { key: 'events', lead: true },
          { key: 'media', lead: true },
        ],
      },
    ],
  },
  {
    key: 'abdulrahman',
    fullName: 'عبدالرحمن فيصل القرشي',
    uniEmail: 's443005244@st.uqu.edu.sa',
    personalEmail: 'abdulrahman.alqurashi@example.com',
    phone: '+966500000108',
    college: CS,
    major: 'هندسة الحاسب',
    level: 7,
    registered: true,
    persona: 'mixed',
    memberships: [
      { club: 'tuwaiq', type: 'عضو فعال', committees: [{ key: 'development', lead: true }] },
      { club: 'computing', type: 'عضو', committees: [{ key: 'programming' }] },
    ],
  },
  {
    key: 'jood',
    fullName: 'جود سلطان الأحمدي',
    uniEmail: 's444003252@st.uqu.edu.sa',
    personalEmail: 'jood.alahmadi@example.com',
    phone: '+966500000109',
    college: CS,
    major: 'علم البيانات والذكاء الاصطناعي',
    level: 4,
    registered: true,
    persona: 'lead',
    memberships: [
      { club: 'tuwaiq', type: 'عضو فعال', committees: [{ key: 'content', lead: true }] },
    ],
  },
  {
    key: 'majed',
    fullName: 'ماجد حسن السلمي',
    uniEmail: 's442006263@st.uqu.edu.sa',
    personalEmail: 'majed.alsulami@example.com',
    phone: '+966500000110',
    college: BUSINESS,
    major: 'التسويق',
    level: 8,
    registered: true,
    persona: 'lead',
    memberships: [{ club: 'tuwaiq', type: 'عضو فعال', committees: [{ key: 'pr', lead: true }] }],
  },
  {
    key: 'ibrahim',
    fullName: 'إبراهيم يوسف الصاعدي',
    uniEmail: 's444004278@st.uqu.edu.sa',
    personalEmail: 'ibrahim.alsaedi@example.com',
    phone: '+966500000111',
    college: CS,
    major: 'هندسة البرمجيات',
    level: 5,
    registered: true,
    persona: 'lead',
    memberships: [
      { club: 'computing', type: 'عضو فعال', committees: [{ key: 'programming', lead: true }] },
    ],
  },
  {
    key: 'faisal',
    fullName: 'فيصل أحمد الدوسري',
    uniEmail: 's445001301@st.uqu.edu.sa',
    personalEmail: 'faisal.aldosari@example.com',
    phone: '+966500000112',
    college: CS,
    major: 'علوم الحاسب',
    level: 3,
    registered: true,
    persona: 'member',
    memberships: [
      { club: 'computing', type: 'عضو', committees: [{ key: 'programming' }, { key: 'events' }] },
    ],
  },
  {
    key: 'lama',
    fullName: 'لمى عبدالعزيز السبيعي',
    uniEmail: 's445002312@st.uqu.edu.sa',
    personalEmail: 'lama.alsubaie@example.com',
    phone: '+966500000113',
    college: DESIGN,
    major: 'التصميم الجرافيكي',
    level: 2,
    registered: true,
    persona: 'member',
    memberships: [{ club: 'computing', type: 'مستفيد', committees: [{ key: 'design' }] }],
  },
  {
    key: 'omar',
    fullName: 'عمر سالم باوزير',
    uniEmail: 's445003323@st.uqu.edu.sa',
    personalEmail: 'omar.bawazir@example.com',
    phone: '+966500000114',
    college: CS,
    major: 'هندسة الحاسب',
    level: 3,
    registered: true,
    persona: 'member',
    memberships: [{ club: 'computing', type: 'عضو', committees: [{ key: 'programming' }] }],
  },
  {
    key: 'asma',
    fullName: 'أسماء محمد الثبيتي',
    uniEmail: 's444005334@st.uqu.edu.sa',
    personalEmail: 'asma.althubaiti@example.com',
    phone: '+966500000115',
    college: CS,
    major: 'نظم المعلومات',
    level: 4,
    registered: true,
    persona: 'member',
    memberships: [
      { club: 'computing', type: 'عضو فعال', committees: [{ key: 'media' }, { key: 'events' }] },
    ],
  },
  {
    key: 'yousef',
    fullName: 'يوسف علي الشمراني',
    uniEmail: 's444006345@st.uqu.edu.sa',
    personalEmail: 'yousef.alshamrani@example.com',
    phone: '+966500000116',
    college: CS,
    major: 'علوم الحاسب',
    level: 5,
    registered: true,
    persona: 'member',
    memberships: [
      { club: 'computing', type: 'عضو', committees: [{ key: 'programming' }] },
      { club: 'tuwaiq', type: 'مستفيد', committees: [{ key: 'development' }] },
    ],
  },
  {
    key: 'rahaf',
    fullName: 'رهف ماجد الجهني',
    uniEmail: 's446001356@st.uqu.edu.sa',
    phone: '+966500000117',
    college: CS,
    major: 'علوم الحاسب',
    level: 1,
    registered: false,
    persona: 'unregistered',
    memberships: [{ club: 'computing', type: 'مستفيد', committees: [] }],
  },
  {
    key: 'turki',
    fullName: 'تركي عبدالله العمري',
    uniEmail: 's446002367@st.uqu.edu.sa',
    college: 'كلية الهندسة والعمارة الإسلامية',
    major: 'الهندسة الكهربائية',
    level: 2,
    registered: false,
    persona: 'unregistered',
    memberships: [{ club: 'computing', type: 'مستفيد', committees: [{ key: 'events' }] }],
  },
  {
    key: 'mona',
    fullName: 'منى سعيد الحازمي',
    uniEmail: 's443006378@st.uqu.edu.sa',
    personalEmail: 'mona.alhazmi@example.com',
    phone: '+966500000119',
    college: CS,
    major: 'علم البيانات والذكاء الاصطناعي',
    level: 6,
    registered: true,
    persona: 'removed',
    memberships: [
      // Was a lead of the design committee; removed from the club 30 days ago (roles reset).
      { club: 'computing', type: 'عضو فعال', removedDaysAgo: 30, committees: [{ key: 'design' }] },
      { club: 'tuwaiq', type: 'عضو فعال', committees: [{ key: 'content' }] },
    ],
  },
  {
    key: 'bandar',
    fullName: 'بندر عادل الزهراني',
    uniEmail: 's445004389@st.uqu.edu.sa',
    personalEmail: 'bandar.alzahrani@example.com',
    phone: '+966500000120',
    college: CS,
    major: 'الأمن السيبراني',
    level: 3,
    registered: true,
    persona: 'member',
    memberships: [{ club: 'computing', type: 'عضو', committees: [{ key: 'programming' }] }],
  },
  {
    key: 'shahad',
    fullName: 'شهد فهد المطيري',
    uniEmail: 's445005391@st.uqu.edu.sa',
    personalEmail: 'shahad.almutairi@example.com',
    phone: '+966500000121',
    college: DESIGN,
    major: 'التصميم الجرافيكي',
    level: 3,
    registered: true,
    persona: 'member',
    memberships: [
      { club: 'computing', type: 'عضو فعال', committees: [{ key: 'design' }, { key: 'media' }] },
    ],
  },
  {
    key: 'waad',
    fullName: 'وعد حمد البقمي',
    uniEmail: 's444007402@st.uqu.edu.sa',
    personalEmail: 'waad.albuqami@example.com',
    phone: '+966500000122',
    college: CS,
    major: 'هندسة البرمجيات',
    level: 4,
    registered: true,
    persona: 'member',
    memberships: [
      { club: 'tuwaiq', type: 'عضو فعال', committees: [{ key: 'development' }, { key: 'pr' }] },
    ],
  },
  {
    key: 'rayan',
    fullName: 'ريان مشعل الحربي',
    uniEmail: 's445006413@st.uqu.edu.sa',
    personalEmail: 'rayan.alharbi@example.com',
    phone: '+966500000123',
    college: SCIENCE,
    major: 'الرياضيات',
    level: 3,
    registered: true,
    persona: 'member',
    memberships: [{ club: 'tuwaiq', type: 'مستفيد', committees: [{ key: 'content' }] }],
  },
  {
    key: 'salman',
    fullName: 'سلمان جابر الفيفي',
    uniEmail: 's446003424@st.uqu.edu.sa',
    phone: '+966500000124',
    college: CS,
    major: 'علوم الحاسب',
    level: 1,
    registered: false,
    persona: 'unregistered',
    memberships: [{ club: 'tuwaiq', type: 'مستفيد', committees: [{ key: 'development' }] }],
  },
  {
    key: 'ghadeer',
    fullName: 'غدير صالح المحمادي',
    uniEmail: 's444008435@st.uqu.edu.sa',
    personalEmail: 'ghadeer.almuhammadi@example.com',
    phone: '+966500000125',
    college: BUSINESS,
    major: 'إدارة الأعمال',
    level: 5,
    registered: true,
    persona: 'member',
    memberships: [{ club: 'tuwaiq', type: 'عضو فعال', committees: [{ key: 'pr' }] }],
  },
  {
    key: 'naif',
    fullName: 'نايف ثامر الرشيدي',
    uniEmail: 's445007446@st.uqu.edu.sa',
    personalEmail: 'naif.alrashidi@example.com',
    phone: '+966500000126',
    college: CS,
    major: 'نظم المعلومات',
    level: 2,
    registered: true,
    persona: 'member',
    memberships: [{ club: 'tuwaiq', type: 'مستفيد', committees: [] }],
  },
  {
    key: 'dana',
    fullName: 'دانة وليد الخزاعي',
    uniEmail: 's444009457@st.uqu.edu.sa',
    personalEmail: 'dana.alkhuzai@example.com',
    phone: '+966500000127',
    college: CS,
    major: 'علم البيانات والذكاء الاصطناعي',
    level: 5,
    registered: true,
    persona: 'member',
    memberships: [
      {
        club: 'tuwaiq',
        type: 'عضو فعال',
        committees: [{ key: 'content' }, { key: 'development' }],
      },
    ],
  },
  {
    key: 'mashael',
    fullName: 'مشاعل راشد اليامي',
    uniEmail: 's445008468@st.uqu.edu.sa',
    personalEmail: 'mashael.alyami@example.com',
    phone: '+966500000128',
    college: SCIENCE,
    major: 'الفيزياء',
    level: 3,
    registered: true,
    persona: 'no-access',
    memberships: [],
  },
  {
    key: 'hessa',
    fullName: 'حصة منصور العسيري',
    uniEmail: 's444010479@st.uqu.edu.sa',
    personalEmail: 'hessa.alasiri@example.com',
    phone: '+966500000129',
    college: CS,
    major: 'علوم الحاسب',
    level: 4,
    registered: true,
    persona: 'member',
    memberships: [
      { club: 'computing', type: 'عضو', committees: [{ key: 'events' }] },
      { club: 'tuwaiq', type: 'عضو فعال', committees: [{ key: 'pr' }] },
    ],
  },
  {
    key: 'layan',
    fullName: 'ليان طارق الغامدي',
    uniEmail: 's446004480@st.uqu.edu.sa',
    college: DESIGN,
    major: 'التصميم الجرافيكي',
    level: 1,
    registered: false,
    persona: 'unregistered',
    memberships: [
      { club: 'tuwaiq', type: 'مستفيد', committees: [{ key: 'pr' }] },
      { club: 'computing', type: 'مستفيد', committees: [{ key: 'design' }] },
    ],
  },
];

/**
 * A club's copy of the person's details (ADR 0012). The dataset lists them once per person, so
 * every club a demo person belongs to starts with the same copy.
 */
export function demoProfile(person: DemoPerson): MemberProfile {
  return {
    personalEmail: person.personalEmail ?? null,
    phone: person.phone ?? null,
    college: person.college ?? null,
    major: person.major ?? null,
    level: person.level ?? null,
  };
}

// ─── Stable ids shared by the seed and the mocks ─────────────

export const demoKeys = {
  user: (personKey: string) => `user:${personKey}`,
  club: (clubKey: DemoClubKey) => `club:${clubKey}`,
  committee: (clubKey: DemoClubKey, committeeKey: string) => `committee:${clubKey}:${committeeKey}`,
  membershipType: (clubKey: DemoClubKey, name: string) => `type:${clubKey}:${name}`,
  membership: (personKey: string, clubKey: DemoClubKey) => `membership:${personKey}:${clubKey}`,
  committeeMembership: (personKey: string, clubKey: DemoClubKey, committeeKey: string) =>
    `committee-membership:${personKey}:${clubKey}:${committeeKey}`,
};
