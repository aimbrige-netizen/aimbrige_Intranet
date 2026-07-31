/**
 * 모듈 패널의 포털 슬롯 id.
 *
 * ModulePanel.tsx는 "use client" 모듈이라, 거기서 export한 상수를 서버
 * 컴포넌트(세그먼트 layout)가 import하면 문자열이 아니라 클라이언트 참조
 * 프록시가 넘어간다. document.getElementById에 그걸 넘기면 영원히 null이다.
 * 그래서 값만 담는 순수 모듈로 분리한다.
 */
export const PANEL_EXTRA_SLOT = "module-panel-extra";
export const PANEL_WIDGET_SLOT = "module-panel-widget";

export type PanelSlot = typeof PANEL_EXTRA_SLOT | typeof PANEL_WIDGET_SLOT;
