import { NextResponse } from 'next/server';
import { searchKinopoiskTitles } from '@/lib/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = typeof body?.query === 'string' ? body.query.trim() : '';

    if (!query) {
      return NextResponse.json([]);
    }

    const results = await searchKinopoiskTitles(query);
    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка поиска названия';
    return new NextResponse(message, { status: 500 });
  }
}
