import type { ExperienceRecord } from "../domain.js";
import { BadRequestError } from "../lib/app-error.js";
import { DeepSeekClient } from "../lib/deepseek-client.js";

const HEADER_SEPARATORS = /\s*(?:\||@|—|–|\s-\s)\s*/u;
const MONTH_SOURCE = String.raw`(?:1[0-2]|0?[1-9])`;
const DATE_RANGE_SOURCE = String.raw`(?:\d{4}(?:\s*年\s*${MONTH_SOURCE}\s*月?|[./-]${MONTH_SOURCE})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\s*(?:-|–|—|~|～|至|到)\s*(?:至今|现在|今|Present|Current|\d{4}(?:\s*年\s*${MONTH_SOURCE}\s*月?|[./-]${MONTH_SOURCE})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})`;
const DATE_RANGE_PATTERN = new RegExp(`(?<time>${DATE_RANGE_SOURCE})`, "iu");
const INVALID_TIMEFRAME_PATTERN = /^(?:unknown(?: timeframe)?|时间待确认|未知|不详|n\/?a)?$/iu;
const ROLE_SIGNAL_PATTERN = /(?:产品|经理|负责人|总监|主管|研发|开发|工程|设计|分析|顾问|运营|市场|销售|研究|架构|测试|实习|助理|创始人|合伙人|product|manager|lead|director|engineer|developer|designer|analyst|consultant|operation|marketing|sales|research|intern|founder|partner|r&d)/iu;
const COMPANY_MARKER_PATTERN = /(?:公司|集团|科技|智能|网络|信息|咨询|工作室|事务所|研究院|实验室|银行|大学|学院|inc\.?|ltd\.?|limited|corp\.?|corporation|company|technologies|technology|digital|studio|labs?|bank|consulting)/iu;
const ACTION_LINE_PATTERN = /^(?:负责|主导|推动|参与|通过|基于|结合|协同|搭建|建设|设计|优化|支持|制定|带领|业务效果|项目背景|最终|成功|帮助|实现|提升|降低|led|built|owned|managed|designed|improved|increased|reduced|responsible)/iu;
const LOCATION_SUFFIX_PATTERN = /(?:北京|上海|广州|深圳|杭州|南京|苏州|成都|重庆|武汉|西安|天津|长沙|郑州|青岛|厦门|宁波|无锡|合肥|福州|东莞|佛山|珠海|香港|澳门|台北|多伦多|温哥华|蒙特利尔|纽约|旧金山|洛杉矶|西雅图|伦敦|新加坡|东京|悉尼)(?:市)?$/u;
const CONTACT_NOISE_PATTERN = /(?:@|https?:\/\/|www\.|^\S+@\S+$|随时到岗|在职|离职|求职状态|电话|手机|微信|linkedin)/iu;

type SectionKind = "work" | "excluded" | null;

interface WorkSection {
  lines: string[];
  hasExplicitHeading: boolean;
}

interface HeaderCandidate {
  company: string;
  role: string;
  timeframe: string;
  headerStart: number;
  contentStart: number;
}

export class ExperienceParserService {
  constructor(private readonly llm: DeepSeekClient) {}

  async parse(rawText: string): Promise<ExperienceRecord[]> {
    const section = this.extractWorkSection(rawText);
    const sectionText = section.lines.join("\n");
    const llmResult = await this.parseWithLlm(sectionText, section);
    const heuristic = this.parseHeuristically(section);

    if (heuristic.length > 0) {
      return heuristic.map((experience) => {
        const enriched = llmResult.find((candidate) => (
          this.comparable(candidate.company) === this.comparable(experience.company)
          && this.comparable(candidate.timeframe) === this.comparable(experience.timeframe)
        ));
        if (!enriched) {
          return experience;
        }
        return {
          ...experience,
          businessContext: enriched.businessContext || experience.businessContext,
          projects: enriched.projects.length > 0 ? enriched.projects : experience.projects,
          responsibilities: enriched.responsibilities.length > 0
            ? enriched.responsibilities
            : experience.responsibilities,
          outcomes: enriched.outcomes.length > 0 ? enriched.outcomes : experience.outcomes,
        };
      });
    }
    if (llmResult.length > 0) {
      return llmResult;
    }
    throw new BadRequestError(
      "没有识别出可信的工作经历。请确认内容包含公司、岗位和任职时间，或改用排版更清晰的 PDF/文本。",
    );
  }

  mergeFactAnswer(experience: ExperienceRecord, answer: string): ExperienceRecord {
    const cleaned = answer.trim();
    if (!cleaned) {
      return experience;
    }
    const next: ExperienceRecord = {
      ...experience,
      evidenceNotes: [...experience.evidenceNotes, cleaned],
      responsibilities: [...experience.responsibilities],
      outcomes: [...experience.outcomes],
      projects: [...experience.projects],
    };
    for (const rawLine of cleaned.split(/\n+/)) {
      const line = rawLine.replace(/^[-•]\s*/, "").trim();
      if (!line) continue;
      if (["负责", "主导", "推动", "搭建", "设计", "优化", "协调"].some((keyword) => line.includes(keyword))) {
        if (!next.responsibilities.includes(line)) next.responsibilities.push(line);
      }
      if (["%", "倍", "提升", "增长", "降低", "留存", "转化", "ROI", "DAU", "GMV"].some((token) => line.includes(token))) {
        if (!next.outcomes.includes(line)) next.outcomes.push(line);
      }
      if (["背景", "业务", "目标", "场景", "用户"].some((keyword) => line.includes(keyword))) {
        if (!next.projects.includes(line)) next.projects.push(line);
      }
    }
    return next;
  }

  private async parseWithLlm(rawText: string, section: WorkSection): Promise<ExperienceRecord[]> {
    if (!rawText.trim()) {
      return [];
    }
    const result = await this.llm.completeJson(
      [
        "你是简历工作经历结构化解析器，只能输出真实任职经历。",
        "忽略个人总结、职业概述、技能、教育、项目、证书、语言和联系方式。",
        "每条 experience 必须有可在原文中定位的 company、role、timeframe；不确定时不要输出。",
        "多栏 PDF 可能把公司与日期、岗位与城市粘在一起，请按工作经历上下文恢复字段。",
        "输出 experiences 数组，字段为 company, role, timeframe, business_context, projects, responsibilities, outcomes。",
      ].join("\n"),
      rawText.slice(0, 12_000),
    );
    if (!result || !Array.isArray(result.experiences)) {
      return [];
    }

    return result.experiences
      .map((item) => this.readLlmExperience(item))
      .filter((item): item is ExperienceRecord => item !== null)
      .filter((item) => this.isSourceGrounded(item, section));
  }

  private readLlmExperience(item: unknown): ExperienceRecord | null {
    if (!item || typeof item !== "object") {
      return null;
    }
    const payload = item as Record<string, unknown>;
    const company = this.cleanCompany(String(payload.company ?? ""));
    const role = this.cleanRole(String(payload.role ?? ""));
    const timeframe = String(payload.timeframe ?? "").trim();
    if (!this.looksLikeCompany(company) || !this.looksLikeRole(role) || !this.isValidTimeframe(timeframe)) {
      return null;
    }
    return {
      id: -1,
      sourceId: -1,
      company,
      role,
      timeframe,
      businessContext: String(payload.business_context ?? "").trim(),
      projects: this.readStringArray(payload.projects),
      responsibilities: this.readStringArray(payload.responsibilities),
      outcomes: this.readStringArray(payload.outcomes),
      evidenceNotes: [],
      selected: false,
      status: "draft",
    };
  }

  private parseHeuristically(section: WorkSection): ExperienceRecord[] {
    const candidates = this.findHeaderCandidates(section.lines);
    return candidates.map((candidate, index) => {
      const nextHeader = candidates[index + 1]?.headerStart ?? section.lines.length;
      const bullets = this.normalizeContentLines(
        section.lines.slice(candidate.contentStart, nextHeader),
      );
      const responsibilities = bullets.slice(0, 12);
      return {
        id: -1,
        sourceId: -1,
        company: candidate.company,
        role: candidate.role,
        timeframe: candidate.timeframe,
        businessContext: bullets[0] ?? "",
        projects: bullets.slice(0, 2),
        responsibilities,
        outcomes: responsibilities.filter((line) => this.looksLikeOutcome(line)).slice(0, 6),
        evidenceNotes: [],
        selected: false,
        status: "draft",
      };
    });
  }

  private findHeaderCandidates(lines: string[]): HeaderCandidate[] {
    const candidates: HeaderCandidate[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const dateMatch = DATE_RANGE_PATTERN.exec(line);
      if (!dateMatch?.groups?.time) {
        continue;
      }
      const timeframe = dateMatch.groups.time.trim();
      const beforeDate = line.slice(0, dateMatch.index).trim().replace(/[|@—–-]+$/u, "").trim();
      const afterDate = line.slice(dateMatch.index + dateMatch[0].length).trim().replace(/^[|@—–-]+/u, "").trim();
      let company = "";
      let role = "";
      let headerStart = index;
      let contentStart = index + 1;

      const sameLineParts = beforeDate.split(HEADER_SEPARATORS).map((part) => part.trim()).filter(Boolean);
      if (sameLineParts.length >= 2) {
        company = sameLineParts[0]!;
        role = sameLineParts.slice(1).join(" ");
      } else if (beforeDate && this.looksLikeRole(beforeDate) && index >= 1) {
        company = lines[index - 1]!;
        role = beforeDate;
        headerStart = index - 1;
      } else if (beforeDate) {
        company = beforeDate;
        const nextLine = lines[index + 1] ?? "";
        role = afterDate && this.looksLikeRole(afterDate) ? afterDate : nextLine;
        contentStart = role === nextLine ? index + 2 : index + 1;
      } else if (afterDate) {
        const afterParts = afterDate.split(HEADER_SEPARATORS).map((part) => part.trim()).filter(Boolean);
        if (afterParts.length >= 2) {
          company = afterParts[0]!;
          role = afterParts.slice(1).join(" ");
        } else if (index >= 1) {
          company = lines[index - 1]!;
          role = afterDate;
          headerStart = index - 1;
        }
      } else if (index >= 2) {
        company = lines[index - 2]!;
        role = lines[index - 1]!;
        headerStart = index - 2;
      }

      company = this.cleanCompany(company);
      role = this.cleanRole(role);
      if (!this.looksLikeCompany(company) || !this.looksLikeRole(role) || !this.isValidTimeframe(timeframe)) {
        continue;
      }
      if (candidates.some((candidate) => candidate.headerStart === headerStart)) {
        continue;
      }
      candidates.push({ company, role, timeframe, headerStart, contentStart });
    }
    return candidates.sort((left, right) => left.headerStart - right.headerStart);
  }

  private extractWorkSection(rawText: string): WorkSection {
    const rawLines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
    const hasExplicitHeading = rawLines.some((line) => this.classifySection(line) === "work");
    if (!hasExplicitHeading) {
      const lines: string[] = [];
      let section: SectionKind = null;
      for (const line of rawLines) {
        const classification = this.classifySection(line);
        if (classification) {
          section = classification;
          continue;
        }
        if (section !== "excluded") {
          lines.push(line);
        }
      }
      return { lines, hasExplicitHeading: false };
    }

    const lines: string[] = [];
    let section: SectionKind = null;
    for (const line of rawLines) {
      const classification = this.classifySection(line);
      if (classification) {
        section = classification;
        continue;
      }
      if (section === "work") {
        lines.push(line);
      }
    }
    return { lines, hasExplicitHeading: true };
  }

  private classifySection(line: string): Exclude<SectionKind, null> | null {
    if (line.length > 48) {
      return null;
    }
    const heading = line
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s_:：|/\\-]+/g, "");
    if (/^(?:工作经历|工作经验|职业经历|职业经验|任职经历|就业经历|workexperience|professionalexperience|employmenthistory|workhistory)$/u.test(heading)) {
      return "work";
    }
    if (/^(?:个人总结|个人概述|个人简介|职业总结|职业概述|职业目标|求职意向|自我评价|核心优势|教育经历|教育背景|项目经历|项目经验|技能|专业技能|核心技能|语言|语言能力|证书|资格证书|认证|获奖经历|荣誉奖项|出版物|志愿经历|个人信息|联系方式|summary|profile|professionalsummary|careerobjective|education|projects?|projectexperience|skills?|technicalskills|languages?|certifications?|awards?|publications?|volunteerexperience|contact)$/u.test(heading)) {
      return "excluded";
    }
    return null;
  }

  private isSourceGrounded(experience: ExperienceRecord, section: WorkSection): boolean {
    const normalizedCompany = this.comparable(experience.company);
    const normalizedRole = this.comparable(experience.role);
    const normalizedTimeframe = this.comparable(experience.timeframe);
    for (let index = 0; index < section.lines.length; index += 1) {
      const nearby = section.lines.slice(Math.max(0, index - 2), index + 3).join(" ");
      if (
        this.comparable(nearby).includes(normalizedCompany)
        && this.comparable(nearby).includes(normalizedRole)
        && this.comparable(nearby).includes(normalizedTimeframe)
      ) {
        return true;
      }
    }
    return false;
  }

  private cleanCompany(value: string): string {
    return value
      .replace(/^[-•|@—–\s]+|[-•|@—–\s]+$/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  private cleanRole(value: string): string {
    const cleaned = value
      .replace(/^[-•|@—–\s]+|[-•|@—–\s]+$/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!ROLE_SIGNAL_PATTERN.test(cleaned)) {
      return cleaned;
    }
    return cleaned.replace(LOCATION_SUFFIX_PATTERN, "").trim();
  }

  private looksLikeCompany(value: string): boolean {
    if (!value || value.length < 2 || value.length > 90) {
      return false;
    }
    if (this.classifySection(value) || CONTACT_NOISE_PATTERN.test(value) || ACTION_LINE_PATTERN.test(value)) {
      return false;
    }
    if (ROLE_SIGNAL_PATTERN.test(value) && !COMPANY_MARKER_PATTERN.test(value)) {
      return false;
    }
    if ((value.match(/[，,。；;：:]/gu)?.length ?? 0) > 1 && !COMPANY_MARKER_PATTERN.test(value)) {
      return false;
    }
    return /[\p{L}\p{N}]/u.test(value);
  }

  private looksLikeRole(value: string): boolean {
    return Boolean(value)
      && value.length <= 60
      && !this.classifySection(value)
      && !CONTACT_NOISE_PATTERN.test(value)
      && ROLE_SIGNAL_PATTERN.test(value);
  }

  private isValidTimeframe(value: string): boolean {
    return !INVALID_TIMEFRAME_PATTERN.test(value.trim()) && DATE_RANGE_PATTERN.test(value);
  }

  private normalizeContentLines(lines: string[]): string[] {
    const normalized: string[] = [];
    for (const rawLine of lines) {
      const hadBullet = /^[-•●▪◦]\s*/u.test(rawLine);
      const line = rawLine.replace(/^[-•●▪◦]\s*/u, "").trim();
      if (
        !line
        || this.classifySection(line)
        || CONTACT_NOISE_PATTERN.test(line)
        || this.isLikelyContactFragment(line)
      ) {
        continue;
      }
      const previous = normalized.at(-1);
      const shouldJoin = Boolean(
        previous
        && !hadBullet
        && !/[。.!！?？；;：:]$/u.test(previous)
        && !ACTION_LINE_PATTERN.test(line)
        && previous.length + line.length <= 320,
      );
      if (shouldJoin) {
        normalized[normalized.length - 1] = `${previous}${line}`;
      } else {
        normalized.push(line);
      }
    }
    return normalized;
  }

  private isLikelyContactFragment(value: string): boolean {
    return value.length <= 20
      && (
        LOCATION_SUFFIX_PATTERN.test(value)
        || /^(?:[\p{L}\p{N}._-]+\|?|[\p{L}\p{N}._-]{2,})$/u.test(value) && !ACTION_LINE_PATTERN.test(value)
      )
      && !ROLE_SIGNAL_PATTERN.test(value);
  }

  private looksLikeOutcome(text: string): boolean {
    return ["%", "增长", "提升", "降低", "减少", "留存", "转化", "ROI", "DAU", "GMV", "revenue", "users"]
      .some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
  }

  private comparable(value: string): string {
    return value.normalize("NFKC").toLowerCase().replace(/[\s|@—–\-~～至到()（）.,，。]/gu, "");
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
}
