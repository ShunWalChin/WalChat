/**
 * Regras puras do estúdio de conteúdo.
 *
 * Valida o que a Instagram API exige de cada formato antes de qualquer
 * container ser criado, para a recusa acontecer aqui e não no provedor.
 */
import { z } from 'zod'

export const contentMediaSchema = z
  .object({
    url: z
      .url()
      .max(2_000)
      .refine((value) => value.startsWith('https://'), {
        message: 'A mídia precisa usar HTTPS público.',
      }),
    type: z.enum(['image', 'video']),
  })
  .strict()

export const contentDraftSchema = z
  .object({
    accountId: z.uuid(),
    kind: z.enum(['feed', 'reel', 'story', 'carousel']),
    title: z.string().trim().min(2).max(150),
    caption: z.string().trim().max(2_200).nullable().optional(),
    script: z.string().trim().max(10_000).nullable().optional(),
    media: z.array(contentMediaSchema).min(1).max(10),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      content.kind === 'feed' &&
      (content.media.length !== 1 || content.media[0].type !== 'image')
    )
      context.addIssue({
        code: 'custom',
        path: ['media'],
        message: 'Feed exige uma imagem.',
      })
    if (
      ['reel', 'story'].includes(content.kind) &&
      (content.media.length !== 1 || content.media[0].type !== 'video')
    )
      context.addIssue({
        code: 'custom',
        path: ['media'],
        message: 'Reel e Story exigem um vídeo.',
      })
    if (
      content.kind === 'carousel' &&
      (content.media.length < 2 || content.media.length > 10)
    )
      context.addIssue({
        code: 'custom',
        path: ['media'],
        message: 'Carrossel exige de 2 a 10 mídias.',
      })
  })

export type ContentDraft = z.infer<typeof contentDraftSchema>
