import { Metadata } from 'next';
import { NotFoundHero } from '@/lib/cms/components/NotFoundHero';

export const metadata: Metadata = {
  title: 'Page Not Found | ORA',
};

export default function NotFound() {
  return <NotFoundHero locale="en" />;
}
