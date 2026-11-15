import logoImg from '../assets/logo.png';

interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className = 'h-8 w-8 object-contain' }: BrandLogoProps) {
  return <img src={logoImg} alt="Iroko Consultoria" className={className} />;
}
