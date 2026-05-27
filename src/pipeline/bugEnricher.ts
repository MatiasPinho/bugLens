import { RawBug, EnrichedBug, GoogleDocContent, CodeFragment } from '../types/index.js'
import { RepoIndexer } from './repoIndexer.js'

// Duck-typed interface — both GoogleDocsReader and BrowserDocsReader satisfy this
interface DocsReader {
  readDocuments(urls: string[]): Promise<GoogleDocContent[]>
}

/**
 * Builds the semantic search query for a bug by concatenating
 * the most meaningful fields.
 */
function buildSearchQuery(bug: RawBug, docText: string): string {
  const parts = [
    bug.title,
    bug.description,
    bug.stepsToReproduce ?? '',
    bug.actualResult ?? '',
    bug.expectedResult ?? '',
    // First 500 chars of the doc for extra signal
    docText.slice(0, 500),
  ]
  return parts.filter(Boolean).join('\n').slice(0, 2000)
}

export class BugEnricher {
  constructor(
    private docsReader: DocsReader | null,
    private repoIndexer: RepoIndexer
  ) {}

  /**
   * Enriches a single bug: fetches Google Docs + finds relevant code fragments.
   * Never throws — errors are embedded inside the result objects.
   */
  async enrich(bug: RawBug): Promise<EnrichedBug> {
    // 1. Fetch Google Docs concurrently
    let googleDocs: GoogleDocContent[] = []
    if (bug.googleDocLinks.length > 0 && this.docsReader) {
      googleDocs = await this.docsReader.readDocuments(bug.googleDocLinks)
    }

    // 2. Aggregate doc text for the search query
    const docText = googleDocs
      .filter((d) => d.accessible)
      .map((d) => d.text)
      .join('\n')

    // 3. Search the repo index
    let codeFragments: CodeFragment[] = []
    try {
      const query = buildSearchQuery(bug, docText)
      codeFragments = await this.repoIndexer.search(query, 5)
    } catch (err) {
      console.warn(`[enricher] repo search failed for bug ${bug.id}:`, err)
    }

    return { raw: bug, googleDocs, codeFragments }
  }

  /**
   * Enriches a list of bugs sequentially, calling the progress callback after each one.
   */
  async enrichAll(
    bugs: RawBug[],
    onProgress?: (current: number, total: number, bugTitle: string) => void
  ): Promise<EnrichedBug[]> {
    const results: EnrichedBug[] = []

    for (let i = 0; i < bugs.length; i++) {
      const bug = bugs[i]
      onProgress?.(i + 1, bugs.length, bug.title)
      const enriched = await this.enrich(bug)
      results.push(enriched)
    }

    return results
  }
}
