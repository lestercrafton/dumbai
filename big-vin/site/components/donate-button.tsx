'use client';

import {useRef, useState, type ReactNode} from 'react';
import {ArrowUpRight, Heart, X} from 'lucide-react';
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {SITE_CONFIG} from '@/lib/site-config';

/** Cash App handles the contribution; this site never collects payment details. */
export function DonateButton({className = '', children}: {className?: string; children?: ReactNode}) {
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const donation = SITE_CONFIG.donation;

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger className={`vin-button vin-donate-trigger ${className}`} aria-label={children ? undefined : 'Boost your karma; support our project'}>
      {children ?? <span className="vin-donate-label">Boost your karma<span>Support our project</span></span>} <ArrowUpRight size={17} aria-hidden="true"/>
    </DialogTrigger>
    <DialogContent className="vin-modal vin-donation-modal" showCloseButton={false} initialFocus={titleRef}>
      <div className="vin-donation-header">
        <span className="vin-modal-icon" aria-hidden="true"><Heart size={23}/></span>
        <p className="vin-kicker">A little support. A better line.</p>
        <DialogTitle ref={titleRef} tabIndex={-1} className="vin-modal-title">Support our project.</DialogTitle>
        <DialogDescription className="vin-modal-description">Built by curiosity. Kept alive by our community.</DialogDescription>
        <DialogClose className="vin-donation-close" aria-label="Close donation message"><X size={20} aria-hidden="true"/></DialogClose>
      </div>
      <div className="vin-donation-layout">
        <div className="vin-donation-message">
          <p>Some people believe gamblers are incorrigible souls.</p>
          <p className="vin-donation-belief">We believe gamblers are the most honorable people alive.</p>
          <p>We just like to see how good we can be at predicting the future.</p>
          <p>So we’re combining old-school handicapping, a blended computer model approach and advanced AI to see how good we can get at it.</p>
          <p>This site will remain open for as long as our community supports it.</p>
          <div className="vin-donation-weeks"><p><strong>Tough week?</strong> You didn’t have to pay for bad picks.</p><p><strong>Good week?</strong> Chip in to keep it going and make it better.</p></div>
          <section className="vin-donation-allocation" aria-labelledby="donation-allocation-title">
            <h3 id="donation-allocation-title">Where the money goes</h3>
            <p>Fees come first. The percentages below apply to the remaining profit.</p>
            <ol>
              <li>Pay the fees to keep the lights on.</li>
              {SITE_CONFIG.profitAllocation.map(item => <li key={item.label}><strong>{item.percent}%.</strong> {item.description}</li>)}
            </ol>
          </section>
          <section className="vin-donation-play" aria-labelledby="donation-play-title">
            <h3 id="donation-play-title">Life comes first.</h3>
            <p>This is for fun and informational purposes only. Gamble at your own risk. No model guarantees a win.</p>
            <p>Need support? In the U.S., call or text <a href="tel:+18006973738">1-800-MY-RESET (1-800-697-3738)</a>, or <a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noopener noreferrer">find confidential help<span className="sr-only"> (opens in a new tab)</span></a>.</p>
            <p>And always remember: your worth isn’t measured by a betting slip. Make your bed. Be good to your woman. Respect your mom and dad. Love Jesus. Don’t chase losses or gamble to solve a cash-flow problem. If gambling stops being fun or starts causing harm, take a break and ask for help. Play responsibly so you can play forever.</p>
          </section>
        </div>
        <aside className="vin-donation-payment" aria-label="Contribute with Cash App">
          <div className="vin-donation-recipient"><span>BIG VIN ON CASH APP</span><strong>{donation.cashtag}</strong></div>
          <a className="vin-button vin-cash-app-link" href={donation.href} target="_blank" rel="noopener noreferrer">
            Donate with Cash App <ArrowUpRight size={18} aria-hidden="true"/>
            <span className="sr-only"> to {donation.cashtag} (opens in a new tab)</span>
          </a>
          <figure className="vin-donation-qr">
            <img src={donation.qrImage} width={164} height={164} alt={`Scan to open ${donation.cashtag} in Cash App`}/>
            <figcaption>On a computer? Scan with your phone.</figcaption>
          </figure>
          <p className="vin-donation-note">Choose your amount and complete your contribution in Cash App.</p>
        </aside>
      </div>
    </DialogContent>
  </Dialog>;
}
