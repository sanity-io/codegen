import {WorkerChannel} from '@sanity/worker-channels'

import {type TypegenWorkerChannel as CodegenTypegenWorkerChannel} from '../typescript/typeGenerator.js'

export interface TypegenGenerateTypesWorkerData {
  schemaPath: string
  searchPath: string | string[]
  workDir: string

  overloadClientMethods?: boolean
}

export type TypegenWorkerChannel = WorkerChannel.Definition<
  CodegenTypegenWorkerChannel['__definition'] & {
    loadedSchema: WorkerChannel.Event
    typegenComplete: WorkerChannel.Event<{code: string}>
    typegenStarted: WorkerChannel.Event<{expectedFileCount: number}>
  }
>
