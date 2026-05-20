import { Metadata } from 'next';
import { NotFoundHero } from '@/lib/cms/components/NotFoundHero';

export const metadata: Metadata = {
  title: 'الصفحة غير موجودة | ORA',
};

export default function NotFound() {
  return <NotFoundHero locale="ar" />;
}
