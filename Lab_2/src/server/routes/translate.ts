import { Router } from 'express';
import type { Request, Response } from 'express';
import type { LanguageCode, TranslateRequest, TranslateResponse } from '../../shared/types.js';

const router = Router();

const allowedLanguages: LanguageCode[] = ['EN', 'UK', 'PL', 'DE', 'FR', 'ES'];

function validateLanguage(value: unknown): value is LanguageCode {
  return typeof value === 'string' && allowedLanguages.includes(value as LanguageCode);
}

router.post('/api/translate', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Partial<TranslateRequest>;
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const sourceLanguage = body.sourceLanguage;
    const targetLanguage = body.targetLanguage;

    if (!process.env.DEEPL_API_KEY) {
      res.status(500).json({ error: 'DeepL API key is not configured.' });
      return;
    }

    if (!text) {
      res.status(400).json({ error: 'Text cannot be empty.' });
      return;
    }

    if (!validateLanguage(targetLanguage)) {
      res.status(400).json({ error: 'Invalid target language.' });
      return;
    }

    const sourceCode = sourceLanguage && sourceLanguage !== 'AUTO' && validateLanguage(sourceLanguage)
      ? sourceLanguage
      : 'AUTO';

    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      },
      body: new URLSearchParams({
        text,
        target_lang: targetLanguage,
        source_lang: sourceCode === 'AUTO' ? '' : sourceCode,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepL API error:', errorText);
      res.status(502).json({ error: 'Translation service is unavailable.' });
      return;
    }

    const data = (await response.json()) as { translations?: Array<{ text?: string }> };
    const translation = data.translations?.[0]?.text ?? '';

    if (!translation) {
      res.status(502).json({ error: 'No translation was returned.' });
      return;
    }

    const payload: TranslateResponse = { translation };
    res.json(payload);
  } catch (error) {
    console.error('Translation endpoint error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
