import type {
  DayStatus,
  EmploymentType,
  JobStatus,
  ProfileKey,
  PunchType,
  Role,
  RsvpStatus,
  Stage,
  TaskPriority,
  TaskStatus,
  UserLite,
  WorkMode,
  AssessmentResult,
  ProfileScores,
  ScreeningAnswer,
  ScreeningQuestion,
  Recommendation,
  DevActionKind,
} from '@dumax/shared';

export type { UserLite, Me } from '@dumax/shared';

export interface DirectoryUser extends UserLite {
  phone: string | null;
  active: boolean;
  lastSeenAt: string | null;
  managerId: string | null;
  departmentId: string | null;
  department: { id: string; name: string; color: string } | null;
  online: boolean;
}

export interface UserDetail extends UserLite {
  phone: string | null;
  active: boolean;
  hiredAt: string | null;
  birthday: string | null;
  lastSeenAt: string | null;
  level: string | null;
  pontoCode: string | null;
  managerId: string | null;
  manager: UserLite | null;
  departmentId: string | null;
  department: { id: string; name: string; color: string } | null;
  teamMemberships: { team: { id: string; name: string } }[];
  workSchedule: WorkSchedule | null;
  reports: UserLite[];
}

export interface WorkSchedule {
  startTime: string;
  endTime: string;
  breakMinutes: number;
  toleranceMinutes: number;
  workDays: number[];
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  color: string;
  parentId: string | null;
  headId: string | null;
  head: UserLite | null;
  _count: { members: number; teams: number };
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  leadId: string | null;
  lead: UserLite | null;
  department: { id: string; name: string; color: string } | null;
  members: { user: UserLite }[];
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  estimatedHours: number | null;
  createdBy: UserLite;
  assignee: UserLite;
  assigneeId: string;
  createdById: string;
  team: { id: string; name: string } | null;
  tags: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  checklist: { id: string; title: string; done: boolean; position: number }[];
  _count: { comments: number };
  /** Pedido de prorrogação aguardando resposta (no máximo um) */
  extensionRequests?: { id: string; requestedDueAt: string; reason: string; requesterId: string }[];
}

export interface TaskDetail extends Task {
  comments: { id: string; body: string; createdAt: string; author: UserLite }[];
  activities: { id: string; type: string; data: Record<string, unknown> | null; createdAt: string; actor: UserLite }[];
}

export interface ChatMember extends UserLite {
  lastSeenAt: string | null;
  isAdmin: boolean;
  lastReadAt: string;
}

export interface ConversationSummary {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  description: string | null;
  avatarUrl: string | null;
  otherUserId: string | null;
  lastMessageAt: string;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  markedUnread: boolean;
  unread: number;
  members: ChatMember[];
  lastMessage: {
    id: string;
    type: 'TEXT' | 'FILE' | 'SYSTEM';
    body: string | null;
    attachmentName: string | null;
    deleted: boolean;
    senderId: string | null;
    senderName: string | null;
    createdAt: string;
  } | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  sender: UserLite | null;
  type: 'TEXT' | 'FILE' | 'SYSTEM';
  body: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentSize: number | null;
  replyToId: string | null;
  replyTo: { id: string; body: string | null; type: string; attachmentName: string | null; deletedAt: string | null; sender: { id: string; name: string } | null } | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: { emoji: string; userId: string; user?: { name: string } }[];
}

export interface Job {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string;
  requirements: string | null;
  benefits: string | null;
  location: string | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salaryMin: number | null;
  salaryMax: number | null;
  showSalary: boolean;
  openings: number;
  status: JobStatus;
  autoSendAssessment: boolean;
  departmentId: string | null;
  department: { id?: string; name: string; color: string } | null;
  publishedAt: string | null;
  closesAt: string | null;
  createdAt: string;
  applicationsTotal?: number;
  byStage?: Partial<Record<Stage, number>>;
  bySource?: Record<string, number>;
  lastWeek?: number;
  idealProfile: ProfileScores | null;
  screeningQuestions: ScreeningQuestion[] | null;
  scorecardCriteria?: string[] | null;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  phone: string;
  linkedinUrl: string | null;
  city: string | null;
}

export interface PipelineCard {
  id: string;
  stage: Stage;
  rating: number | null;
  createdAt: string;
  stageUpdatedAt: string;
  source: string | null;
  candidate: Candidate;
  profile: ProfileKey | null;
  hasResume: boolean;
  fit: number | null;
  screeningAnswers: ScreeningAnswer[] | null;
}

export interface FitAnalysis {
  fit: number | null;
  label: { label: string; color: string } | null;
  ideal: ProfileScores | null;
  gaps: { profile: ProfileKey; candidate: number; ideal: number; diff: number }[];
  probes: { profile: ProfileKey; question: string }[];
  team: { avg: ProfileScores | null; size: number; fitWithTeam: number | null; complement: ProfileKey[] } | null;
}

export interface ApplicationDetail {
  id: string;
  stage: Stage;
  rating: number | null;
  coverLetter: string | null;
  resumeName: string | null;
  resumePath: string | null;
  rejectionReason: string | null;
  source: string | null;
  createdAt: string;
  screeningAnswers: ScreeningAnswer[] | null;
  candidate: Candidate & { applications: { id: string; stage: Stage; createdAt: string; job: { title: string } }[] };
  job: { id: string; title: string; slug: string; idealProfile: ProfileScores | null; scorecardCriteria: string[] | null; department: { name: string } | null };
  scorecards: Scorecard[];
  referredBy: UserLite | null;
  analysis: FitAnalysis | null;
  events: {
    id: string;
    type: string;
    fromStage: Stage | null;
    toStage: Stage | null;
    body: string | null;
    meta: Record<string, unknown> | null;
    createdAt: string;
    author: UserLite | null;
  }[];
  assessments: {
    id: string;
    token: string;
    url: string;
    status: 'PENDING' | 'COMPLETED' | 'EXPIRED';
    result: (AssessmentResult & { ai?: AiReading }) | null;
    primaryProfile: ProfileKey | null;
    expiresAt: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  }[];
  whatsappUrl: string;
}

/** Avaliação estruturada de um entrevistador */
export interface Scorecard {
  id: string;
  authorId: string;
  author: UserLite;
  ratings: { name: string; rating: number; note?: string | null }[];
  recommendation: Recommendation;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  requiresAck: boolean;
  readByMe: boolean;
  readCount: number;
  audience: number;
  createdAt: string;
  author: UserLite;
}

export interface Kudos {
  id: string;
  value: string;
  message: string;
  createdAt: string;
  from: UserLite;
  to: UserLite;
}

export interface PulseSurvey {
  id: string;
  weekStart: string;
  question: string;
  status: 'OPEN' | 'CLOSED';
  closesAt: string;
}

export interface TimeDay {
  id: string;
  userId: string;
  date: string;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  expectedMinutes: number;
  lateMinutes: number;
  balanceMinutes: number;
  status: DayStatus;
  user?: UserLite;
}

export interface TimeEntry {
  id: string;
  userId: string;
  at: string;
  type: PunchType;
  source: string;
  note: string | null;
}

export interface PontoSummary {
  days: number;
  workedMinutes: number;
  expectedMinutes: number;
  balanceMinutes: number;
  lateCount: number;
  lateMinutes: number;
  absentCount: number;
  incompleteCount: number;
}

export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  videoUrl: string | null;
  organizerId: string;
  organizer: UserLite;
  createdVia: string;
  participants: { userId: string; rsvp: RsvpStatus; user: UserLite }[];
}

export interface PeopleMetric {
  user: UserLite & { department: { id: string; name: string; color: string } | null };
  open: number;
  overdue: number;
  inProgress: number;
  blocked: number;
  doneLast30: number;
  onTimeRate: number | null;
  lateArrivals30: number;
}

export type { Role, Stage, TaskStatus, TaskPriority, JobStatus, ProfileKey, DayStatus };

// ───────────── v2: desempenho, metas, horas, documentos, licenças ─────────────
import type { FeedbackType, FlagSeverity, LicenseCategory, LicenseState, PerformanceFlag, ScoreLevel, TimeLogActivity } from '@dumax/shared';

export interface TimeLog {
  id: string;
  userId: string;
  taskId: string | null;
  task: { id: string; title: string } | null;
  activity: TimeLogActivity;
  description: string | null;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
}

export interface GoalCheckin {
  id: string;
  value: number;
  note: string | null;
  createdAt: string;
  author: UserLite;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  ownerId: string;
  owner: UserLite;
  createdBy: UserLite;
  team: { id: string; name: string } | null;
  unit: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  higherIsBetter: boolean;
  startDate: string;
  dueDate: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELED';
  checkins: GoalCheckin[];
  progress: number;
  elapsed: number;
}

export interface PerfMetrics {
  tasksDone: number;
  effortDone: number;
  onTimeRate: number | null;
  overdueOpen: number;
  openTasks: number;
  blocked: number;
  avgCycleHours: number | null;
  workedMinutes: number;
  expectedMinutes: number;
  loggedMinutes: number;
  meetingMinutes: number;
  untrackedMinutes: number;
  utilization: number | null;
  workDays: number;
  lateDays: number;
  absentDays: number;
  punctuality: number | null;
  goalsCount: number;
  goalProgress: number | null;
  reworkMinutes: number;
}

export type PerfComponents = Partial<Record<'onTime' | 'throughput' | 'utilization' | 'punctuality' | 'goals', number>>;
type DeptUser = UserLite & { department: { id: string; name: string; color: string } | null };

export interface PerformanceOverview {
  period: { from: string; to: string; days: number };
  summary: {
    people: number;
    avgScore: number | null;
    prevAvgScore: number | null;
    avgUtilization: number | null;
    avgOnTime: number | null;
    avgPunctuality: number | null;
    workedHours: number;
    untrackedHours: number;
    tasksDone: number;
    overdueOpen: number;
    distribution: Record<ScoreLevel, number>;
  };
  people: {
    user: DeptUser & { managerId: string | null };
    score: number | null;
    prevScore: number | null;
    delta: number | null;
    level: ScoreLevel | null;
    components: PerfComponents;
    metrics: PerfMetrics;
    flags: PerformanceFlag[];
  }[];
  insights: (PerformanceFlag & { user: DeptUser })[];
}

export interface Feedback {
  id: string;
  type: FeedbackType;
  body: string;
  actionItems: string[];
  private: boolean;
  createdAt: string;
  author: UserLite;
}

export interface PersonPerformanceData {
  user: DeptUser & { hiredAt: string | null; manager: UserLite | null; workSchedule: WorkSchedule | null };
  period: { from: string; to: string; days: number };
  score: number | null;
  prevScore: number | null;
  level: ScoreLevel | null;
  components: PerfComponents;
  metrics: PerfMetrics & { activity: Record<string, number> };
  prevMetrics: PerfMetrics;
  peerAvgScore: number | null;
  flags: PerformanceFlag[];
  weekly: { weekStart: string; done: number; onTimeRate: number | null; workedHours: number; loggedHours: number; meetingHours: number; untrackedHours: number; score: number | null }[];
  activity: { key: TimeLogActivity | 'AGENDA'; minutes: number }[];
  openTasks: (Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'dueAt' | 'createdAt'> & { createdBy: UserLite })[];
  recentDone: { id: string; title: string; completedAt: string; dueAt: string | null; priority: TaskPriority }[];
  goals: Goal[];
  feedbacks: Feedback[];
  logs: TimeLog[];
  canManage: boolean;
}

export type { FlagSeverity, PerformanceFlag };

export interface DocSigner {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  cpf: string | null;
  role: string;
  order: number;
  status: 'PENDING' | 'SIGNED' | 'DECLINED';
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  signatureImage?: string | null;
  signatureText?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  signUrl?: string;
  myToken?: string;
}

export interface DocEvent {
  id: string;
  type: string;
  actorName: string | null;
  signerId: string | null;
  ip: string | null;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  message: string | null;
  category: string;
  fileName: string;
  fileSize: number;
  fileHash: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELED' | 'EXPIRED';
  sequential: boolean;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  createdById: string;
  createdBy: UserLite;
  signers: DocSigner[];
  events?: DocEvent[];
  myTurn?: boolean;
  canManage?: boolean;
}

export interface LicenseRenewal {
  id: string;
  previousExpiresAt: string;
  newExpiresAt: string;
  note: string | null;
  fileName: string | null;
  createdAt: string;
  renewedBy: UserLite;
}

export interface License {
  id: string;
  name: string;
  category: LicenseCategory;
  number: string | null;
  issuer: string | null;
  description: string | null;
  issuedAt: string | null;
  expiresAt: string;
  responsibleId: string;
  responsible: UserLite;
  backupId: string | null;
  backup: UserLite | null;
  alertDays: number[];
  notifyEmails: string[];
  notifyAdmins: boolean;
  cost: number | null;
  fileName: string | null;
  archived: boolean;
  daysLeft: number;
  state: LicenseState;
  renewals: LicenseRenewal[];
}

export interface Inbox {
  mustRead: { id: string; title: string; createdAt: string }[];
  oneOnOneActions: { id: string; text: string; dueAt: string | null; withUserId: string }[];
  reviews: { id: string; title: string; assignee: { id: string; name: string; avatarUrl: string | null } }[];
  celebrations: { user: { id: string; name: string; avatarUrl: string | null; jobTitle: string | null }; kind: 'BIRTHDAY' | 'ANNIVERSARY'; inDays: number; years?: number }[];
  extensionRequests: { id: string; requestedDueAt: string; reason: string; requester: { id: string; name: string; avatarUrl: string | null }; task: { id: string; title: string } }[];
  tasks: { open: number; overdue: number; dueToday: number; top: { id: string; title: string; dueAt: string | null; priority: TaskPriority; status: TaskStatus; createdBy: UserLite }[] };
  documentsToSign: { id: string; title: string; dueAt: string | null; from: string; token: string }[];
  pulse: { id: string; question: string; answered: boolean } | null;
  licenses: { id: string; name: string; expiresAt: string; daysLeft: number; state: LicenseState }[];
  goals: (Pick<Goal, 'id' | 'title' | 'unit' | 'startValue' | 'targetValue' | 'currentValue' | 'dueDate' | 'startDate'> & { progress: number; elapsed: number })[];
  runningTimer: TimeLog | null;
  meetingsToday: { id: string; title: string; startsAt: string; endsAt: string; videoUrl: string | null; location: string | null }[];
  team: { alerts: { user: { id: string; name: string; avatarUrl: string | null }; message: string; severity: string }[] } | null;
}

/** Leitura do teste escrita pela IA (resumo, pontos fortes, atenção e perguntas) */
export interface AiReading {
  summary: string;
  strengths: string[];
  risks: string[];
  questions: string[];
  generatedAt: string;
}

// ───────────── 1:1 ─────────────
export interface OneOnOneItem {
  id: string;
  oneOnOneId: string;
  kind: 'TOPIC' | 'ACTION';
  text: string;
  done: boolean;
  dueAt: string | null;
  createdAt: string;
  author: UserLite;
  owner: UserLite | null;
}
export interface OneOnOne {
  id: string;
  managerId: string;
  reportId: string;
  scheduledAt: string;
  status: 'OPEN' | 'DONE';
  notes: string | null;
  items: OneOnOneItem[];
}
export interface OneOnOnePairSummary {
  user: UserLite;
  next: Pick<OneOnOne, 'id' | 'scheduledAt' | 'status'> | null;
  last: Pick<OneOnOne, 'id' | 'scheduledAt' | 'status'> | null;
  openActions: number;
}
export interface OneOnOneHome {
  reports: OneOnOnePairSummary[];
  manager: OneOnOnePairSummary | null;
}
export interface OneOnOnePair {
  manager: UserLite;
  report: UserLite;
  meetings: OneOnOne[];
  openActions: OneOnOneItem[];
}

// ───────────── PDI ─────────────
export interface DevelopmentAction {
  id: string;
  planId: string;
  text: string;
  kind: DevActionKind;
  dueDate: string | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}
export interface DevelopmentPlan {
  id: string;
  userId: string;
  title: string;
  focus: string | null;
  status: 'ACTIVE' | 'DONE' | 'CANCELED';
  dueDate: string | null;
  createdAt: string;
  createdBy: UserLite;
  actions: DevelopmentAction[];
}
