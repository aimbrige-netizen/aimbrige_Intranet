import type { Metadata } from "next";
import { UiCatalog } from "./UiCatalog";

export const metadata: Metadata = { title: "UI 카탈로그" };

/**
 * 프리미티브 카탈로그.
 *
 * 화면을 조립할 때 "이 자리에 뭘 써야 하지"를 매번 다시 판단하지 않으려고 둔다.
 * 부품이 눈에 보이면 카드를 하나 더 놓는 대신 Meter를 쓰게 된다.
 * 제품 메뉴에는 노출하지 않는다(직접 URL로만 접근).
 */
export default function DevUiPage() {
  return <UiCatalog />;
}
