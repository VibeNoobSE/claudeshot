registerGame("boxing", "🥊 Boxing", "A/D+SPACE = P1, ←/→+ENTER = P2", "Knock out your opponent!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#2e1a1a");
    this.add.rectangle(W/2,H-20,500,4,0x888888); // ring floor
    this.add.rectangle(W/2-250,H/2,4,H,0xe94560);this.add.rectangle(W/2+250,H/2,4,H,0xe94560); // ropes
    this.p1=this.add.rectangle(W/2-100,H/2,30,50,0xf7c948);this.p2=this.add.rectangle(W/2+100,H/2,30,50,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);p.setData("hp",100);p.setData("stun",0);});
    this.physics.add.collider(this.p1,this.p2);
    this.hp1=this.add.rectangle(W/4,30,200,16,0xf7c948);this.hp2=this.add.rectangle(W*3/4,30,200,16,0xe94560);
    this.add.rectangle(W/4,30,200,16).setStrokeStyle(1,0xffffff);this.add.rectangle(W*3/4,30,200,16).setStrokeStyle(1,0xffffff);
    this.add.text(W/4,12,"P1",{fontSize:"12px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.add.text(W*3/4,12,"P2",{fontSize:"12px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({a:"A",d:"D",space:"SPACE",left:"LEFT",right:"RIGHT",enter:Phaser.Input.Keyboard.KeyCodes.ENTER});
    this.lp1=0;this.lp2=0;this.over=false;
  }
  punch(attacker,defender,hpBar,label,t,lastRef){
    if(t<lastRef+300||defender.getData("stun")>0)return t;
    const dist=Phaser.Math.Distance.Between(attacker.x,attacker.y,defender.x,defender.y);
    if(dist<60){const dmg=Phaser.Math.Between(5,15);const hp=Math.max(0,defender.getData("hp")-dmg);defender.setData("hp",hp);
      hpBar.width=hp*2;defender.setData("stun",10);defender.body.setVelocityX(attacker.x<defender.x?200:-200);
      if(hp<=0&&!this.over){this.over=true;this.physics.pause();this.add.text(W/2,H/2,(label==="P2"?"P1":"P2")+" KO!",{fontSize:"48px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}}
    return t;
  }
  update(t){if(this.over)return;const s=200,k=this.k;
    [this.p1,this.p2].forEach(p=>{const st=p.getData("stun");if(st>0)p.setData("stun",st-1);});
    if(this.p1.getData("stun")<=0)this.p1.body.setVelocityX(k.a.isDown?-s:k.d.isDown?s:0);
    if(this.p2.getData("stun")<=0)this.p2.body.setVelocityX(k.left.isDown?-s:k.right.isDown?s:0);
    if(k.space.isDown)this.lp1=this.punch(this.p1,this.p2,this.hp2,"P2",t,this.lp1);
    if(k.enter.isDown)this.lp2=this.punch(this.p2,this.p1,this.hp1,"P1",t,this.lp2);
  }
});
