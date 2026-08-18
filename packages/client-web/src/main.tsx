import { bootMinimalWeb } from './index.tsx'

const element = document.getElementById('root')
if (element === null) throw new Error('minimal client web: #root element is missing')

void bootMinimalWeb(element).catch((error: unknown) => {
  console.error(error)
})
