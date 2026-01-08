'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Play } from 'lucide-react';

interface TestRunnerProps {
  onSubmit: (prompt: string, url: string, credentials?: Record<string, string>) => void;
}

export function TestRunner({ onSubmit }: TestRunnerProps) {
  const [prompt, setPrompt] = useState('');
  const [url, setUrl] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [credentialKey, setCredentialKey] = useState('');
  const [credentialValue, setCredentialValue] = useState('');

  const handleAddCredential = () => {
    if (credentialKey && credentialValue) {
      setCredentials((prev) => ({
        ...prev,
        [credentialKey]: credentialValue,
      }));
      setCredentialKey('');
      setCredentialValue('');
    }
  };

  const handleSubmit = () => {
    if (!prompt || !url) {
      alert('Please provide both a test prompt and URL');
      return;
    }
    onSubmit(prompt, url, Object.keys(credentials).length > 0 ? credentials : undefined);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Test</CardTitle>
        <CardDescription>
          Describe what you want to test in natural language
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="url">Application URL</Label>
          <Input
            id="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="prompt">Test Description</Label>
          <Textarea
            id="prompt"
            placeholder="e.g., Login with email and password, then update profile name to 'John Doe'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
          />
        </div>

        <div className="space-y-2">
          <Label>Credentials (Optional)</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Key (e.g., email)"
              value={credentialKey}
              onChange={(e) => setCredentialKey(e.target.value)}
            />
            <Input
              type="password"
              placeholder="Value"
              value={credentialValue}
              onChange={(e) => setCredentialValue(e.target.value)}
            />
            <Button onClick={handleAddCredential} variant="outline">
              Add
            </Button>
          </div>
          {Object.keys(credentials).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(credentials).map(([key, value]) => (
                <div key={key} className="text-sm text-muted-foreground flex justify-between">
                  <span>{key}:</span>
                  <span>{'*'.repeat(value.length)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button onClick={handleSubmit} className="w-full" size="lg">
          <Play className="mr-2 h-4 w-4" />
          Run Test
        </Button>
      </CardContent>
    </Card>
  );
}
