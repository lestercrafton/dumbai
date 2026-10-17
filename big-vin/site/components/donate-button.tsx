'use client';

import {useState, type ReactNode} from 'react';
import {ArrowUpRight, Heart} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {SITE_CONFIG} from '@/lib/site-config';

/** Cash App handles the contribution; this site never collects payment details. */
export function DonateButton({className = '', children}: {className?: string; children?: ReactNode}) {
  const [open, setOpen] = useState(false);
  const donation = SITE_CONFIG.donation;

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger className={`vin-button vin-donate-trigger ${className}`}>
      {children ?? 'Donate to our project'} <ArrowUpRight size={17} aria-hidden="true"/>
    </DialogTrigger>
    <DialogContent className="vin-modal vin-donation-modal">
      <span className="vin-modal-icon" aria-hidden="true"><Heart size={26}/></span>
      <p className="vin-kicker">A little support. A better line.</p>
      <DialogTitle className="vin-modal-title">Back the project.</DialogTitle>
      <DialogDescription className="vin-modal-description">
        Help support the data, hosting and model research behind Big Vin. Choose your contribution in Cash App.
      </DialogDescription>
      <div className="vin-donation-recipient"><span>BIG VIN ON CASH APP</span><strong>{donation.cashtag}</strong></div>
      <a className="vin-button vin-cash-app-link" href={donation.href} target="_blank" rel="noopener noreferrer">
        Donate with Cash App <ArrowUpRight size={18} aria-hidden="true"/>
        <span className="sr-only"> to {donation.cashtag} (opens in a new tab)</span>
      </a>
      <figure className="vin-donation-qr">
        <img src={donation.qrImage} width={164} height={164} alt={`Scan to open ${donation.cashtag} in Cash App`}/>
        <figcaption>On a computer? Scan with your phone.</figcaption>
      </figure>
      <p className="vin-donation-note">You’ll complete your contribution securely in Cash App.</p>
    </DialogContent>
  </Dialog>;
}
