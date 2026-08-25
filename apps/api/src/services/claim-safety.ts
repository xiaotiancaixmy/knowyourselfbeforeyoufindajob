import type {
  ClaimRestriction,
  ExperienceRecord,
  GoalSetupState,
  PositioningDecisionState,
  ResumeRewriteOutput,
} from "../domain.js";

export type ClaimRestrictionsByExperienceId = Record<number, ClaimRestriction[]>;

type OwnershipStrength = "neutral" | "limited" | "contributor" | "strong";

const OWNERSHIP_RESTRICTION_CODES = new Set([
  "ownership_unverified",
  "ownership_limited",
  "claim_blocked",
]);
const OWNERSHIP_STRENGTH: Record<OwnershipStrength, number> = {
  neutral: 0,
  limited: 1,
  contributor: 2,
  strong: 3,
};
const STRONG_OWNERSHIP_PATTERN = /主导|牵头|统筹|全权(?:负责)?|独立(?:设计|负责|完成|推进|承担|搭建|操盘)|负责(?:整体|全程|端到端|核心|主要)?|全程(?:推进|负责|主导)|核心(?:操盘|负责人|主导)|推动[^。；，,\n]{0,24}落地|从\s*[0０零]\s*到\s*[1１一]|端到端|全链路|\bled\b|\bowned\b|\bowner\b/iu;
const LIMITED_OWNERSHIP_PATTERN = /参与|协助|配合|支持/iu;
const CONTRIBUTOR_OWNERSHIP_PATTERN = /(?:^|[。；，,\n]\s*)(?:设计|搭建|推动|推进|优化|建立|分析|协调|测试|整理|执行|交付)/iu;
const NEGATED_OWNERSHIP_PATTERN = /(?:不|未|没有|并非|不是|避免|不要|不可|不能|无需)[^。；，,\n]{0,16}(?:主导|牵头|统筹|全权|独立|负责|全程|核心操盘|推动[^。；，,\n]{0,8}落地|从\s*[0０零]\s*到\s*[1１一]|端到端|全链路)/giu;
const NUMBER_PATTERN = /\d+(?:\.\d+)?(?:%|％|年|个月|月|周|天|人|个|项|次|家|倍|万|亿|[kKwW])?|[零〇一二两三四五六七八九十百千]+(?:%|％|年|个月|月|周|天|人|个|项|次|家|倍|万|亿)/gu;

export function hasOwnershipRestriction(restrictions: ClaimRestriction[] = []): boolean {
  return restrictions.some((restriction) => OWNERSHIP_RESTRICTION_CODES.has(restriction.code));
}

export function hasConfirmedStrongOwnership(experience: ExperienceRecord): boolean {
  return getExperienceOwnershipStrength(experience) === "strong";
}

function getExperienceText(experience: ExperienceRecord): string {
  return [
    experience.company,
    experience.role,
    experience.timeframe,
    experience.businessContext,
    ...experience.projects,
    ...experience.responsibilities,
    ...experience.outcomes,
    ...experience.evidenceNotes,
  ].join(" ");
}

function stripNegatedOwnershipClaims(value: string): string {
  return value.replace(NEGATED_OWNERSHIP_PATTERN, " ");
}

function getTextOwnershipStrength(value: string): OwnershipStrength {
  const text = stripNegatedOwnershipClaims(value);
  if (STRONG_OWNERSHIP_PATTERN.test(text)) {
    return "strong";
  }
  if (LIMITED_OWNERSHIP_PATTERN.test(text)) {
    return "limited";
  }
  if (CONTRIBUTOR_OWNERSHIP_PATTERN.test(text)) {
    return "contributor";
  }
  return "neutral";
}

function getExperienceOwnershipStrength(experience: ExperienceRecord): OwnershipStrength {
  return getTextOwnershipStrength([
    ...experience.responsibilities,
    ...experience.evidenceNotes,
  ].join(" "));
}

export function hasOnlyLimitedOwnership(experience: ExperienceRecord): boolean {
  return getExperienceOwnershipStrength(experience) === "limited";
}

export function makeResponsibilitySafe(value: string, restrictions: ClaimRestriction[] = []): string {
  if (!hasOwnershipRestriction(restrictions) || getTextOwnershipStrength(value) !== "strong") {
    return value;
  }
  return "参与相关工作";
}

function extractNumbers(value: string): Set<string> {
  return new Set(value.match(NUMBER_PATTERN) ?? []);
}

function hasUnsupportedNumber(value: string, supportedNumbers: Set<string>): boolean {
  return [...extractNumbers(value)].some((number) => !supportedNumbers.has(number));
}

function includesIdentityTerm(value: string, term: string): boolean {
  const normalizedValue = value.toLocaleLowerCase();
  const normalizedTerm = term.trim().toLocaleLowerCase();
  if (normalizedTerm.length < 2) {
    return false;
  }
  if (/^[a-z0-9 ]+$/u.test(normalizedTerm)) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "u")
      .test(normalizedValue);
  }
  return normalizedValue.includes(normalizedTerm);
}

function getSummaryIdentityTerms(
  experience: ExperienceRecord,
  experiences: ExperienceRecord[],
): string[] {
  const terms = [
    experience.company,
    ...experience.projects,
  ];
  if (experiences.filter((candidate) => candidate.role === experience.role).length === 1) {
    terms.push(experience.role);
  }
  if (experiences.filter((candidate) => candidate.timeframe === experience.timeframe).length === 1) {
    terms.push(experience.timeframe);
  }
  return terms.filter((term) =>
    term.trim()
    && !/^unknown(?: company| role| timeframe)?$/iu.test(term.trim())
  );
}

function isProfessionalSummaryNumberSafe(
  professionalSummary: string,
  experiences: ExperienceRecord[],
): boolean {
  const numbersByExperienceId = new Map(
    experiences.map((experience) => [
      experience.id,
      extractNumbers(getExperienceText(experience)),
    ]),
  );
  const statements = professionalSummary
    .split(/[。！？!?；;\n]+/u)
    .map((statement) => statement.trim())
    .filter(Boolean);

  return statements.every((statement) => {
    const numbers = extractNumbers(statement);
    if (numbers.size === 0) {
      return true;
    }
    const attributedExperiences = experiences.filter((experience) =>
      getSummaryIdentityTerms(experience, experiences)
        .some((term) => includesIdentityTerm(statement, term))
    );
    const requiredExperiences = attributedExperiences.length > 0
      ? attributedExperiences
      : experiences;
    return [...numbers].every((number) =>
      requiredExperiences.length > 0
      && requiredExperiences.every((experience) =>
        numbersByExperienceId.get(experience.id)?.has(number)
      )
    );
  });
}

function allowedOwnershipStrength(
  experience: ExperienceRecord,
  restrictions: ClaimRestriction[],
): OwnershipStrength {
  if (hasOwnershipRestriction(restrictions)) {
    return "limited";
  }
  return getExperienceOwnershipStrength(experience);
}

function exceedsOwnershipStrength(value: string, allowed: OwnershipStrength): boolean {
  return OWNERSHIP_STRENGTH[getTextOwnershipStrength(value)] > OWNERSHIP_STRENGTH[allowed];
}

export function isRewriteClaimSafe(params: {
  rewrite: ResumeRewriteOutput;
  experiences: ExperienceRecord[];
  restrictionsByExperienceId: ClaimRestrictionsByExperienceId;
  goalSetup?: GoalSetupState | null;
  positioningDecision?: PositioningDecisionState | null;
}): boolean {
  const {
    rewrite,
    experiences,
    restrictionsByExperienceId,
    goalSetup,
    positioningDecision,
  } = params;
  void goalSetup;
  void positioningDecision;

  const selectedIds = new Set(experiences.map((experience) => String(experience.id)));
  if (Object.keys(rewrite.experienceBulletsByExperienceId).some((experienceId) => !selectedIds.has(experienceId))) {
    return false;
  }

  if (!isProfessionalSummaryNumberSafe(rewrite.professionalSummary, experiences)) {
    return false;
  }

  const summaryAllowedStrength = experiences.reduce<OwnershipStrength>((allowed, experience) => {
    const experienceAllowed = allowedOwnershipStrength(
      experience,
      restrictionsByExperienceId[experience.id] ?? [],
    );
    return OWNERSHIP_STRENGTH[experienceAllowed] < OWNERSHIP_STRENGTH[allowed]
      ? experienceAllowed
      : allowed;
  }, "strong");
  if (exceedsOwnershipStrength(rewrite.professionalSummary, summaryAllowedStrength)) {
    return false;
  }

  for (const experience of experiences) {
    const restrictions = restrictionsByExperienceId[experience.id] ?? [];
    const bullets = rewrite.experienceBulletsByExperienceId[String(experience.id)] ?? [];
    const confirmedNumbers = extractNumbers(getExperienceText(experience));
    const ownershipStrength = allowedOwnershipStrength(experience, restrictions);
    if (bullets.some((bullet) =>
      hasUnsupportedNumber(bullet, confirmedNumbers)
      || exceedsOwnershipStrength(bullet, ownershipStrength)
    )) {
      return false;
    }
  }

  return true;
}
