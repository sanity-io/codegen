import {SanityCommand} from '@sanity/cli-core'

export class TypegenGenerateCommand extends SanityCommand<typeof TypegenGenerateCommand> {
  public async run() {
    console.log('not generate')
  }
}
