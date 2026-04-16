import { NextResponse } from 'next/server';
import { searchTitleResults } from '@/lib/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    const contentType = typeof body?.contentType === 'string' ? body.contentType : 'anime';
    const settings = typeof body?.settings === 'object' && body.settings ? body.settings : {};

    if (!query) {
      return NextResponse.json([]);
    }

    const results = await searchTitleResults({
      query,
      contentType,
      settings
    });
    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка поиска названия';
    return new NextResponse(message, { status: 500 });
  }
}
