export async function POST(request: Request) {
  try {
    const body = await request.json();
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : '';
    const fileName = typeof body?.fileName === 'string' ? body.fileName : 'preview';

    if (!imageUrl) {
      return new Response('Не передан URL изображения', { status: 400 });
    }

    const response = await fetch(imageUrl, { cache: 'no-store' });
    if (!response.ok) {
      return new Response('Не удалось загрузить изображение', { status: 500 });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const buffer = await response.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}.${extension}"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка скачивания';
    return new Response(message, { status: 500 });
  }
}
