// ==========================================
// 会员专属占位组件
// ==========================================
export function MemberOnlyPlaceholder({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-100 p-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
      {text}
    </div>
  );
}
