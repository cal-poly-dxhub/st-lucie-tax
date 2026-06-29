import { useState, useRef, useEffect } from 'react';

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = text.trim();
    if (msg && !disabled) {
      onSend(msg);
      setText('');
    }
  };

  return (
    <form className="input-area" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder || 'Describe what you need...'}
        disabled={disabled}
        autoComplete="off"
      />
      <button type="submit" disabled={disabled || !text.trim()}>
        Send
      </button>
    </form>
  );
}
