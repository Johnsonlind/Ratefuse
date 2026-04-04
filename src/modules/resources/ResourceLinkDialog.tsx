import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog } from '../../shared/ui/Dialog';
import { Input } from '../../shared/ui/Input';
import { Button } from '../../shared/ui/Button';
import type { ResourceItem, ResourceType } from '../../api/resources';
import { RESOURCE_TYPE_LABEL } from './resourceLogos';

export function ResourceLinkDialog({
  open,
  onClose,
  resourceType,
  existing,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  resourceType: ResourceType;
  existing?: ResourceItem | null;
  onSubmit: (payload: { link: string; extraction_code?: string | null }) => Promise<void>;
}) {
  const [link, setLink] = useState('');
  const [code, setCode] = useState('');
  const [agreement, setAgreement] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const title = useMemo(() => {
    const name = RESOURCE_TYPE_LABEL[resourceType] || resourceType;
    return existing ? `编辑资源 · ${name}` : `添加资源 · ${name}`;
  }, [existing, resourceType]);

  useEffect(() => {
    if (!open) return;
    setLink(existing?.link || '');
    setCode(existing?.extraction_code || '');
    setAgreement(false);
  }, [open, existing]);

  const requireAgreement = !existing;
  const canSubmit = link.trim().length > 0 && !submitting && (!requireAgreement || agreement);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (submitting) return;
        onClose();
      }}
      title={title}
    >
      <div className="space-y-4">
        <Input
          label="资源链接"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="粘贴网盘/磁力链接"
        />
        <Input
          label="提取码（可选）"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="如有提取码可填写"
        />
        {requireAgreement && (
          <label className="flex items-start gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={agreement} onChange={(e) => setAgreement(e.target.checked)} />
            我确认上传内容版权自负，因侵权产生的责任由本人自行承担，与本站无关。
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => {
              if (submitting) return;
              onClose();
            }}
          >
            取消
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              if (!link.trim()) return;
              if (requireAgreement && !agreement) {
                toast.error('请先勾选协议');
                return;
              }
              setSubmitting(true);
              try {
                await onSubmit({
                  link: link.trim(),
                  extraction_code: code.trim() ? code.trim() : null,
                });
                toast.success(existing ? '已更新资源' : '已添加资源');
                onClose();
              } catch (err: any) {
                toast.error(err?.message || '提交失败');
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? '提交中...' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

