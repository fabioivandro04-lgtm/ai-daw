import { engine } from '../audio'
import { renderProject } from '../audio/engine'
import { importSample, loadSamples } from '../audio/samples'
import { audioBufferToWav } from '../audio/wav'
import { demoProject, emptyProject } from '../core/commands'
import { useDaw } from '../core/store'
import type { Project } from '../core/types'

function replaceProject(project: Project) {
  engine.stop()
  useDaw.setState((s) => ({ project, past: [...s.past, { project: s.project }], future: [], selectedChannelId: project.channels[0]?.id ?? null }))
}

export const newProject = () => confirm('Start a new empty project? (You can undo with Ctrl+Z.)') && replaceProject(emptyProject())
export const loadDemo = () => replaceProject(demoProject())

export async function exportWav() {
  const p = useDaw.getState().project
  await loadSamples(sampleIds(p), await engine.ensure())
  const url = URL.createObjectURL(audioBufferToWav(await renderProject(p)))
  const a = document.createElement('a')
  a.href = url
  a.download = `${p.songMode ? 'song' : 'pattern'}-${p.bpm}bpm.wav`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function sampleIds(p: Project): string[] {
  return p.channels.flatMap((c) => (c.sampleId ? [c.sampleId] : []))
}

/** Adds one sample channel per audio file. Returns error messages for files that could not be read. */
export async function addSampleFiles(files: Iterable<File>): Promise<string[]> {
  const ctx = await engine.ensure()
  const errors: string[] = []
  for (const file of files) {
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i.test(file.name)) {
      errors.push(`${file.name}: not an audio file`)
      continue
    }
    try {
      const { id, name } = await importSample(file, ctx)
      useDaw.getState().run('add_sample_channel', { name, sampleId: id })
    } catch {
      errors.push(`${file.name}: the browser could not decode it`)
    }
  }
  return errors
}

export function pickSampleFiles() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*'
  input.multiple = true
  input.onchange = async () => {
    const errors = await addSampleFiles(input.files ?? [])
    if (errors.length) alert(errors.join('\n'))
  }
  input.click()
}

export function togglePlay() {
  if (engine.playing) engine.stop()
  else engine.play()
}
