registerGame("king-of-hill", "👑 King of Hill", "WASD = P1, Arrows = P2", "Hold the zone longest to win", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.zone=this.add.rectangle(W/2,H/2,120,120,0x334466);
    this.add.rectangle(W/2,H/2,120,120).setStrokeStyle(2,0xf7c948);
    this.p1=this.add.circle(150,H/2,16,0xf7c948);this.p2=this.add.circle(W-150,H/2,16,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setBounce(0.5);});
    this.physics.add.collider(this.p1,this.p2);
    this.s1=0;this.s2=0;this.timeLeft=30;
    this.s1Txt=this.add.text(16,16,"P1: 0",{fontSize:"20px",color:"#f7c948",fontFamily:"monospace"});
    this.s2Txt=this.add.text(W-120,16,"P2: 0",{fontSize:"20px",color:"#e94560",fontFamily:"monospace"});
    this.timeTxt=this.add.text(W/2,30,"30s",{fontSize:"24px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.timer=this.time.addEvent({delay:1000,callback:()=>{if(--this.timeLeft<=0){this.physics.pause();this.add.text(W/2,H/2,(this.s1>this.s2?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}this.timeTxt.setText(this.timeLeft+"s");},loop:true});
    this.scoreTick=this.time.addEvent({delay:100,callback:()=>{
      const zx=W/2,zy=H/2,zs=60;
      if(Math.abs(this.p1.x-zx)<zs&&Math.abs(this.p1.y-zy)<zs){this.s1++;this.s1Txt.setText("P1: "+this.s1);}
      if(Math.abs(this.p2.x-zx)<zs&&Math.abs(this.p2.y-zy)<zs){this.s2++;this.s2Txt.setText("P2: "+this.s2);}
    },loop:true});
  }
  update(){const s=280,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
  }
});
