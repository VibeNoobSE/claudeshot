registerGame("territory", "🏰 Territory", "WASD = P1, Arrows = P2", "Capture zones by standing in them!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.zones=[];this.s1=0;this.s2=0;
    const positions=[[200,120],[400,120],[600,120],[200,H/2],[400,H/2],[600,H/2],[200,H-120],[400,H-120],[600,H-120]];
    positions.forEach(([x,y])=>{const z={x,y,owner:-1,progress:0,rect:this.add.rectangle(x,y,70,70,0x333355).setStrokeStyle(2,0x555577)};this.zones.push(z);});
    this.p1=this.add.circle(50,H/2,14,0xf7c948);this.p2=this.add.circle(W-50,H/2,14,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);});
    this.physics.add.collider(this.p1,this.p2);
    this.sTxt=this.add.text(W/2,10,"P1: 0 | P2: 0",{fontSize:"18px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.timeLeft=30;
    this.timeTxt=this.add.text(W/2,H-14,this.timeLeft+"s",{fontSize:"14px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.time.addEvent({delay:1000,callback:()=>{
      this.zones.forEach(z=>{if(z.owner===0)this.s1++;if(z.owner===1)this.s2++;});
      this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);
      if(--this.timeLeft<=0){this.physics.pause();this.add.text(W/2,H/2,(this.s1>this.s2?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
      this.timeTxt.setText(this.timeLeft+"s");
    },loop:true});
  }
  update(){const s=250,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    this.zones.forEach(z=>{
      const p1In=Math.abs(this.p1.x-z.x)<35&&Math.abs(this.p1.y-z.y)<35;
      const p2In=Math.abs(this.p2.x-z.x)<35&&Math.abs(this.p2.y-z.y)<35;
      if(p1In&&!p2In){z.progress=Math.min(z.progress+0.02,1);if(z.progress>=1)z.owner=0;}
      else if(p2In&&!p1In){z.progress=Math.max(z.progress-0.02,-1);if(z.progress<=-1)z.owner=1;}
      z.rect.fillColor=z.owner===0?0x665500:z.owner===1?0x660022:0x333355;
    });
  }
});
