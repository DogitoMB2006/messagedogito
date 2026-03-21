import { Phone, PhoneOff } from 'lucide-react';
import { Modal } from '../ui/modal';

interface IncomingCallModalProps {
  isOpen: boolean;
  callerName: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallModal({ isOpen, callerName, onAccept, onDecline }: IncomingCallModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onDecline}
      title="Incoming call"
      description={`${callerName} is calling you`}
      size="sm"
    >
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDecline}
          className="inline-flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 transition-colors"
        >
          <PhoneOff size={16} />
          Decline
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/25 transition-colors"
        >
          <Phone size={16} />
          Accept
        </button>
      </div>
    </Modal>
  );
}
