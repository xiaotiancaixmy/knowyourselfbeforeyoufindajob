from __future__ import annotations

from dataclasses import dataclass

from src.models.domain import EvidenceGap, ExperienceRecord


@dataclass(frozen=True)
class FactCompletionEntryChoice:
    label: str
    draft: str


QUESTION_LADDERS = {
    "result": [
        "这件事做完以后，你最先感受到的变化是什么？",
        "如果先不追求特别精确的数据，这段经历最后至少带来了什么方向性的变化？",
    ],
    "ownership": [
        "如果把整件事拆开，你自己最主要盯的是哪一块？",
        "哪些部分最明显是你亲自负责推进的？",
    ],
    "scope": [
        "当时这件事大概影响的是哪一块业务、哪类用户，或者哪个团队？",
        "如果你回头概括一下，这更像单点优化、核心链路，还是跨团队项目？",
    ],
    "decision": [
        "当时你最先抓住、最想优先处理的重点是什么？",
        "如果回头看，这里面有没有一个比较关键的判断是你自己做的？",
    ],
    "tradeoff": [
        "推进这件事时，你最常在两件什么事情之间来回平衡？",
        "如果再往下讲一步，这里面有没有一个比较典型的 tradeoff？",
    ],
    "failure": [
        "当时推进过程中，哪一部分最不顺？",
        "有没有哪个地方比你原来想的更难，后来你怎么调过来的？",
    ],
    "influence": [
        "这件事推进时，你主要需要跟哪些人配合？",
        "如果别人一开始不完全同频，你通常是怎么把事情往前推的？",
    ],
}

QUESTION_BANK = {gap_type: ladder[0] for gap_type, ladder in QUESTION_LADDERS.items()}

SCAFFOLD_LINES = [
    "这个项目当时主要是为了解决……",
    "我当时主要负责的是……",
    "当时最难的是……",
]

GAP_PRIORITIES = ["result", "ownership", "scope", "decision", "tradeoff", "failure", "influence"]


class FollowupQuestionService:
    def build_light_signal(self, experience: ExperienceRecord, gaps: list[EvidenceGap]) -> str:
        if not gaps:
            return f"`{experience.company}` 这段已经比较完整了，我会帮你确认最值得保留的亮点。"
        high_risk = [gap for gap in gaps if gap.severity == "high"]
        if high_risk:
            return (
                f"`{experience.company}` 这段我先不急着下判断，先陪你把场景、你亲自做过的部分和结果线索慢慢讲清楚。"
            )
        return f"`{experience.company}` 这段已经有基础了，我会一边帮你提炼亮点，一边把还缺的细节补齐。"

    def build_warm_start(self, experience: ExperienceRecord) -> str:
        return (
            f"让我们开始回忆你在 `{experience.company}` 都做过什么。"
            " 很多时候你其实做了不少，只是一下子不知道该怎么表达，没关系，我会陪你一起收敛。"
            " 你可以先随便讲，也可以先选一个更接近的切入口开始。"
        )

    def build_reflection(self, experience: ExperienceRecord) -> str:
        plain_signal = self._build_plain_signal(experience)
        hiring_signal = self._build_hiring_signal(experience)
        return (
            "你刚刚已经把这段经历的场景往前带出来了。\n\n"
            f"{plain_signal}\n"
            f"如果用 hiring 的语言来说，这里已经有一点 {hiring_signal}。"
        )

    def build_targeted_questions(self, gaps: list[EvidenceGap], *, limit: int = 1) -> list[str]:
        gap_map = {gap.gap_type: gap for gap in gaps}
        questions: list[str] = []
        for gap_type in GAP_PRIORITIES:
            gap = gap_map.get(gap_type)
            if not gap:
                continue
            question = gap.next_question or QUESTION_BANK.get(gap_type, "你可以继续补一点更具体的细节。")
            questions.append(question)
            if len(questions) >= limit:
                break
        return questions

    def build_sentence_scaffold(self) -> str:
        return "你可以顺着这些半句继续讲：\n- " + "\n- ".join(SCAFFOLD_LINES)

    def build_gap_reveal(self, gaps: list[EvidenceGap]) -> str:
        questions = self.build_targeted_questions(gaps, limit=1)
        if not questions:
            return "这段已经比较完整了。"
        return f"如果从 hiring 视角再往前走一步，我下一轮最想补的是：{questions[0]}"

    def build_entry_choices(self, experience: ExperienceRecord) -> list[FactCompletionEntryChoice]:
        choices: list[FactCompletionEntryChoice] = []
        if experience.business_context.strip():
            summary = self._shorten(experience.business_context.strip(), 18)
            choices.append(
                FactCompletionEntryChoice(
                    label="先讲当时在做什么",
                    draft=(
                        f"我先从当时在做什么讲起。那时候我们主要在做 {summary}，"
                        "我当时被拉进来主要是为了把这件事往前推进。"
                    ),
                )
            )

        for responsibility in experience.responsibilities[:2]:
            cleaned = responsibility.strip()
            if not cleaned:
                continue
            choices.append(
                FactCompletionEntryChoice(
                    label=f"先讲：{self._shorten(cleaned, 14)}",
                    draft=(
                        f"如果先讲我自己做的部分，我会先从「{cleaned}」讲起。"
                        "这块当时我主要负责的是"
                    ),
                )
            )

        if experience.outcomes:
            outcome = experience.outcomes[0].strip()
            if outcome:
                choices.append(
                    FactCompletionEntryChoice(
                        label="先讲结果最明显的一段",
                        draft=(
                            f"如果先讲最有结果感的一段，应该是「{self._shorten(outcome, 18)}」背后的那次推进。"
                            "我当时主要做的是"
                        ),
                    )
                )

        choices.append(
            FactCompletionEntryChoice(
                label="先讲最卡的一段",
                draft="如果先从最卡的一段开始讲，当时最不顺的地方其实是",
            )
        )

        deduped: list[FactCompletionEntryChoice] = []
        seen_labels: set[str] = set()
        for choice in choices:
            if choice.label in seen_labels:
                continue
            seen_labels.add(choice.label)
            deduped.append(choice)
            if len(deduped) >= 4:
                break
        return deduped

    def _build_plain_signal(self, experience: ExperienceRecord) -> str:
        if experience.outcomes and len(experience.responsibilities) >= 2:
            return "用白话说，这里已经能看出你不是只在执行，而是在把事情往前推，而且开始有结果感了。"
        if len(experience.responsibilities) >= 2:
            return "用白话说，这里已经能看出你在主动推进事情，不是只在被动接任务。"
        if experience.outcomes:
            return "用白话说，这里已经开始有结果和影响的轮廓了。"
        return "用白话说，这段已经有主线了，我们接下来把你亲自做过的部分再讲清楚一点。"

    def _build_hiring_signal(self, experience: ExperienceRecord) -> str:
        labels: list[str] = []
        if len(experience.responsibilities) >= 2:
            labels.append("ownership")
        if experience.outcomes:
            labels.append("results orientation")
        if self._contains_any(experience, ["判断", "取舍", "方案", "优先级", "decision"]):
            labels.append("judgment")
        if self._contains_any(experience, ["推动", "协调", "说服", "stakeholder", "cross-functional"]):
            labels.append("cross-functional influence")
        if not labels:
            labels.append("ownership")
        return "、".join(labels[:3])

    def _contains_any(self, experience: ExperienceRecord, keywords: list[str]) -> bool:
        tokens = " ".join(
            experience.responsibilities
            + experience.outcomes
            + experience.projects
            + experience.evidence_notes
            + [experience.business_context]
        ).lower()
        return any(keyword.lower() in tokens for keyword in keywords)

    def _shorten(self, text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        return text[:limit].rstrip() + "..."
