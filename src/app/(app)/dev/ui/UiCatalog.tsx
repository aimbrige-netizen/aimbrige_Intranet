"use client";

import { useState } from "react";
import {
  CalendarCheck,
  CalendarPlus,
  Clock3,
  FileText,
  Inbox,
  Plane,
  Sun,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Card,
  CardBody,
  CardHeader,
  SectionHeader,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { Meter, MiniMeter } from "@/components/ui/Progress";
import { StatCard } from "@/components/ui/StatCard";
import { DayStrip, type StripDay } from "@/components/ui/ChipStrip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { OptionCardGrid } from "@/components/ui/OptionCardGrid";
import { EmptyState, TableEmptyRow } from "@/components/ui/EmptyState";
import { DataTable, Td, Th } from "@/components/ui/Table";
import { SkeletonStats } from "@/components/ui/Skeleton";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";

/** 주 52시간 임계선 — 근태 화면과 같은 규칙 */
const WEEK_THRESHOLDS = [
  { at: 40, label: "40h", tone: "brand" as const },
  { at: 48, label: "48h", tone: "warning" as const },
  { at: 52, label: "52h", tone: "critical" as const },
];

export function UiCatalog() {
  const [view, setView] = useState<"week" | "month">("week");
  const [leaveType, setLeaveType] = useState<string | null>("annual");
  const [selected, setSelected] = useState("2026-07-29");

  return (
    <>
      <PageHeader
        title="UI 카탈로그"
        description="화면 조립에 쓸 수 있는 부품 목록. 제품 메뉴에는 노출하지 않는다."
        meta={
          <>
            <span>디자인시스템 v2.0 (SEED)</span>
            <span>·</span>
            <span>src/components/ui</span>
          </>
        }
      />

      <div className="space-y-8">
        <Section
          title="Meter"
          note="진행바 + 임계 눈금. 지표의 분모를 눈으로 보여준다."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <Meter
              value={25.2}
              max={52}
              thresholds={WEEK_THRESHOLDS}
              label="이번 주 근무"
              valueLabel="25h 14m"
              showScale
            />
            <Meter
              value={49.5}
              max={52}
              thresholds={WEEK_THRESHOLDS}
              label="경고 구간 예시"
              valueLabel="49h 30m"
              showScale
            />
            <Meter
              value={7.25}
              max={17}
              tone="brand"
              label="연차 소진율"
              valueLabel="43% (7.25 / 17)"
            />
            <Meter
              max={30}
              segments={[
                { value: 18, tone: "positive", label: "열람" },
                { value: 5, tone: "warning", label: "부분" },
              ]}
              label="공지 열람 현황"
              valueLabel="23 / 30명"
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-label text-muted">표 셀용 MiniMeter</span>
            <MiniMeter value={12} max={30} tone="informative" />
            <span className="text-label tabular-nums text-ink">12/30</span>
          </div>
        </Section>

        <Section
          title="StatCard"
          note="분모·임계선·상태를 담는다. tone='brand'는 한 화면에 하나만."
        >
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="잔여 연차"
              value={7.75}
              unit="일"
              denominator={17}
              tone="brand"
              icon={CalendarCheck}
              emphasis
              max={17}
              meterValue={7.25}
              sub="소진율 43% · 다음 발생 08-01"
            />
            <StatCard
              label="이번 주 근무"
              value="25h 14m"
              denominator="40h"
              tone="neutral"
              icon={Clock3}
              max={52}
              meterValue={25.2}
              thresholds={WEEK_THRESHOLDS}
              scale
            />
            <StatCard
              label="이번 주 근무일"
              value={2}
              unit="일"
              denominator={5}
              tone="informative"
              icon={CalendarPlus}
              delta={{ label: "+1", direction: "up" }}
            />
            <StatCard
              label="Drive 사용량"
              value="—"
              tone="neutral"
              icon={FileText}
              state="disconnected"
            />
          </div>
        </Section>

        <Section
          title="DayStrip"
          note="표 위에 두는 7일 칩 스트립. 기록이 없는 날도 점선으로 골격을 남긴다."
        >
          <DayStrip
            days={(
              [
                { date: "2026-07-26" },
                {
                  date: "2026-07-27",
                  chips: [
                    {
                      lines: [
                        "8h 30m",
                        { text: "출 08:00 · 퇴 17:30", dim: true },
                      ],
                      tone: "success",
                    },
                  ],
                },
                {
                  date: "2026-07-28",
                  chips: [
                    {
                      lines: [
                        "8h 30m",
                        { text: "출 08:00 · 퇴 17:30", dim: true },
                      ],
                      tone: "success",
                    },
                  ],
                },
                {
                  date: "2026-07-29",
                  selected: true,
                  chips: [
                    {
                      lines: [
                        "9h 00m",
                        { text: "출 08:00 · 퇴 18:00", dim: true },
                      ],
                      tone: "success",
                    },
                    { lines: ["초과 1h 00m"], tone: "warn" },
                  ],
                  onSelect: setSelected,
                },
                {
                  date: "2026-07-30",
                  chips: [{ lines: ["연차", { text: "종일", dim: true }] }],
                },
                { date: "2026-07-31", holiday: "임시공휴일" },
                { date: "2026-08-01", muted: true },
              ] satisfies StripDay[]
            ).map((d) => ({
              ...d,
              selected: d.date === selected,
              onSelect: setSelected,
            }))}
          />
        </Section>

        <Section title="PeriodNavigator + SegmentedControl">
          <PeriodNavigator
            label="2026-07-27 ~ 2026-08-02"
            sublabel="이번 주"
            atToday
            right={
              <SegmentedControl
                options={[
                  { value: "week", label: "주간" },
                  { value: "month", label: "월간" },
                ]}
                value={view}
                onChange={setView}
                ariaLabel="기간 단위"
              />
            }
          />
          <SegmentedControl
            options={[
              { value: "mine", label: "내가 올린 문서", badge: 4 },
              { value: "inbox", label: "내가 승인할 문서", badge: 2 },
            ]}
            value="mine"
            onChange={() => {}}
            size="small"
          />
        </Section>

        <Section
          title="OptionCardGrid"
          note="드롭다운으로는 '고르면 어떻게 되는지'를 못 보여준다."
        >
          <OptionCardGrid
            options={[
              {
                value: "annual",
                title: "연차",
                description: "근로기준법에 따라 부여되는 법정 유급휴가",
                icon: CalendarCheck,
                meta: ["잔여 7.75일", "만료 2026-12-31"],
              },
              {
                value: "half",
                title: "반차",
                description: "0.5일 차감",
                icon: Sun,
                meta: ["잔여 7.75일"],
              },
              {
                value: "family",
                title: "가족돌봄휴가",
                description: "연차에서 차감되지 않음",
                icon: Plane,
                meta: ["무급", "연 10일"],
              },
              {
                value: "birthday",
                title: "생일휴가",
                description: "1일 지급",
                icon: Sun,
                disabled: true,
                disabledLabel: "사용완료",
              },
            ]}
            value={leaveType}
            onChange={setLeaveType}
          />
        </Section>

        <Section title="Callout" note="개발 진행 상황을 여기에 적지 않는다.">
          <div className="space-y-2.5">
            <Callout tone="info" title="연차는 승인 시점에 차감됩니다">
              법정휴가는 잔여에서 차감되지 않고 별도로 기록됩니다.
            </Callout>
            <Callout tone="warn" title="결재선이 지정되지 않았습니다">
              시스템 관리자가 결재라인 설정에서 최종 결재자를 지정해야 문서를
              올릴 수 있습니다.
            </Callout>
            <Callout tone="danger" title="주 52시간을 초과했습니다">
              이번 주 누적 근무가 53시간 20분입니다.
            </Callout>
          </div>
        </Section>

        <Section title="TableToolbar / 빈 상태">
          <TableToolbar
            search={<ToolbarSearch placeholder="제목·작성자 검색" />}
            filters={
              <>
                <FilterChip active count={12}>
                  전체
                </FilterChip>
                <FilterChip count={4}>대기</FilterChip>
                <FilterChip count={8}>완료</FilterChip>
              </>
            }
            count="12건"
            actions={
              <Button size="small" variant="secondary">
                내보내기
              </Button>
            }
          />
          <Card>
            {/* 표는 헤더 아래 굵은 선 하나뿐 — 행 구분선이 없다(실측 03-approval.md) */}
            <DataTable>
              <thead>
                <tr>
                  <Th>날짜</Th>
                  <Th>출근</Th>
                  <Th>퇴근</Th>
                  <Th align="right">근무시간</Th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["2026-07-27", "09:02", "18:10", "8h 08m"],
                  ["2026-07-28", "08:55", "19:40", "9h 45m"],
                  ["2026-07-29", "09:10", "18:02", "7h 52m"],
                ].map(([date, inAt, outAt, worked]) => (
                  <tr key={date}>
                    <Td numeric nowrap>
                      {date}
                    </Td>
                    <Td numeric>{inAt}</Td>
                    <Td numeric>{outAt}</Td>
                    <Td align="right" numeric>
                      {worked}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>

          <Card className="mt-4">
            <DataTable>
              <thead>
                <tr>
                  <Th>날짜</Th>
                  <Th>출근</Th>
                  <Th>퇴근</Th>
                  <Th>근무시간</Th>
                </tr>
              </thead>
              <tbody>
                <TableEmptyRow
                  colSpan={4}
                  icon={Inbox}
                  title="이 기간에 기록이 없습니다"
                  description="컬럼 구조는 남겨서 이 표가 무엇을 추적하는지 알 수 있게 한다."
                  action={<Button size="small">근태 수정요청</Button>}
                />
              </tbody>
            </DataTable>
          </Card>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="카드 안 빈 상태" density="compact" />
              <CardBody density="compact">
                {/* 빈 상태 CTA는 브랜드색 채운 버튼이다 — cta prop이 기본으로 그렇게 낸다 */}
                <EmptyState
                  icon={Inbox}
                  title="대기 중인 문서가 없습니다"
                  cta={{ label: "기안하기", href: "/approvals/new" }}
                  compact
                />
              </CardBody>
            </Card>
            <div>
              <SectionHeader title="로딩 자리표시" />
              <SkeletonStats count={2} />
            </div>
          </div>
        </Section>

        <Section title="Badge / Button">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>기본</Badge>
            <Badge tone="primary">브랜드</Badge>
            <Badge tone="success">승인</Badge>
            <Badge tone="info">진행중</Badge>
            <Badge tone="warn">주의</Badge>
            <Badge tone="danger">반려</Badge>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button>주요 액션</Button>
            <Button variant="primary-low">보조 브랜드</Button>
            <Button variant="secondary">취소</Button>
            <Button variant="danger">삭제</Button>
            <Button variant="ghost">더보기</Button>
          </div>
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <SectionHeader title={title} description={note} />
      <div className="rounded-card border border-line bg-surface p-5">
        {children}
      </div>
    </section>
  );
}
