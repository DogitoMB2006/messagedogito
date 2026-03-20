import { Loader2, LogOut } from 'lucide-react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';

interface LeaveGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupName: string;
  isOwner: boolean;
  loading?: boolean;
  onConfirmLeave: () => void | Promise<void>;
}

export function LeaveGroupModal({
  isOpen,
  onClose,
  groupName,
  isOwner,
  loading = false,
  onConfirmLeave,
}: LeaveGroupModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={loading ? () => {} : onClose}
      title={isOwner ? 'Cannot leave as owner' : 'Leave this group?'}
      description={
        isOwner
          ? 'Transfer ownership to another member or delete the group from settings.'
          : `You will stop seeing "${groupName}" in your messages. Other members will see that you left.`
      }
      size="sm"
    >
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <Button type="button" variant="outline" disabled={loading} onClick={onClose} className="rounded-xl border-border/60">
          {isOwner ? 'Close' : 'Cancel'}
        </Button>
        {!isOwner && (
          <Button
            type="button"
            variant="danger"
            disabled={loading}
            className="rounded-xl gap-2"
            onClick={() => void onConfirmLeave()}
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <LogOut size={18} />}
            Leave group
          </Button>
        )}
      </div>
    </Modal>
  );
}
