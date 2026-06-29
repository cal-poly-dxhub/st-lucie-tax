/**
 * File upload component for DL photos and documents.
 */

import { useState, useRef } from 'react';
import { getUploadUrl, uploadToS3 } from '../api';

interface Props {
  sessionId: string;
  documentType: string;
  label: string;
  accept?: string;
  onUploaded: (s3Key: string) => void;
}

export function FileUpload({ sessionId, documentType, label, accept, onUploaded }: Props) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setStatus('uploading');

    try {
      const { uploadUrl, s3Key } = await getUploadUrl(sessionId, documentType, file.name);
      await uploadToS3(uploadUrl, file);
      setStatus('done');
      onUploaded(s3Key);
    } catch (err) {
      console.error('Upload failed:', err);
      setStatus('error');
    }
  };

  return (
    <div className="file-upload">
      <input
        ref={inputRef}
        type="file"
        accept={accept || 'image/*,.pdf'}
        onChange={handleFile}
        style={{ display: 'none' }}
      />
      <button
        className="upload-btn"
        onClick={() => inputRef.current?.click()}
        disabled={status === 'uploading'}
      >
        {status === 'idle' && label}
        {status === 'uploading' && 'Uploading...'}
        {status === 'done' && `Uploaded: ${fileName}`}
        {status === 'error' && 'Upload failed — try again'}
      </button>
    </div>
  );
}
